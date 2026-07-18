import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { extractLabel, isSupportedMediaType, SUPPORTED_MEDIA_TYPES } from "@/lib/extract";
import { verify } from "@/lib/compare";
import { measureWarningTypeSize, type TypeSizeResult } from "@/lib/typesize";
import type { ApplicationRecord, ApplicationSubmission } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * Turn an upstream failure into something an agent can act on. Raw provider
 * JSON is useful in the server log and useless on Dave's screen.
 */
function describeFailure(error: unknown): { message: string; status: number } {
  if (error instanceof Anthropic.APIError) {
    if (error.status === 401 || error.status === 403) {
      return {
        message:
          "The label reading service rejected our credentials. Contact your administrator.",
        status: 502,
      };
    }
    if (error.status === 429) {
      return {
        message: "Too many labels at once. Wait a moment and try again.",
        status: 429,
      };
    }
    if (error.status && error.status >= 500) {
      return {
        message:
          "The label reading service is temporarily unavailable. Try again in a minute.",
        status: 503,
      };
    }
    return {
      message: "The label reading service could not process this image.",
      status: 502,
    };
  }

  if (error instanceof SyntaxError) {
    return {
      message:
        "The label was read but the response could not be understood. Try again.",
      status: 502,
    };
  }

  // Our own thrown Errors (truncation, empty response) are already plain English.
  if (error instanceof Error) {
    return { message: error.message, status: 502 };
  }

  return { message: "Could not check this label. Try again.", status: 502 };
}

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "The server is missing its ANTHROPIC_API_KEY. Contact your administrator." },
      { status: 500 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return badRequest("Could not read the uploaded form data.");
  }

  const image = form.get("image");
  if (!(image instanceof File)) {
    return badRequest("Please attach a label image.");
  }
  if (image.size === 0) {
    return badRequest("The uploaded image is empty.");
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return badRequest(
      `Image is ${(image.size / 1024 / 1024).toFixed(1)} MB. The limit is ${
        MAX_IMAGE_BYTES / 1024 / 1024
      } MB.`,
    );
  }
  if (!isSupportedMediaType(image.type)) {
    return badRequest(
      `Unsupported image format "${image.type || "unknown"}". Use ${SUPPORTED_MEDIA_TYPES.map(
        (t) => t.replace("image/", "").toUpperCase(),
      ).join(", ")}.`,
    );
  }

  const application: ApplicationRecord = {
    brandName: String(form.get("brandName") ?? "").trim(),
    classType: String(form.get("classType") ?? "").trim(),
    alcoholContent: String(form.get("alcoholContent") ?? "").trim(),
    netContents: String(form.get("netContents") ?? "").trim(),
  };

  const missing = (Object.entries(application) as [keyof ApplicationRecord, string][])
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) {
    return badRequest(`Missing application values: ${missing.join(", ")}.`);
  }

  // Deliberately assembled *after* the required-field check and only when the
  // caller actually sent a value: a domestic spirits application carries
  // neither of these, and an empty string here would make compare.ts assert
  // something the applicant never claimed.
  const submission: ApplicationSubmission = { ...application };
  const bottlerAddress = String(form.get("bottlerAddress") ?? "").trim();
  const countryOfOrigin = String(form.get("countryOfOrigin") ?? "").trim();
  const labelWidthMm = String(form.get("labelWidthMm") ?? "").trim();
  if (bottlerAddress) submission.bottlerAddress = bottlerAddress;
  if (countryOfOrigin) submission.countryOfOrigin = countryOfOrigin;
  if (labelWidthMm) submission.labelWidthMm = labelWidthMm;

  // A width we cannot parse is rejected here rather than quietly ignored. The
  // type-size check is the one place in this app where a wrong number produces
  // a confident wrong verdict instead of a visible mismatch, so "45mm-ish" must
  // not silently become "no width supplied" and read as "not assessed".
  const parsedWidthMm = labelWidthMm ? Number(labelWidthMm) : undefined;
  if (
    parsedWidthMm !== undefined &&
    (!Number.isFinite(parsedWidthMm) || parsedWidthMm <= 0)
  ) {
    return badRequest(
      `Label width must be a positive number of millimetres; received "${labelWidthMm}".`,
    );
  }

  const started = Date.now();
  try {
    const bytes = Buffer.from(await image.arrayBuffer());
    const base64 = bytes.toString("base64");

    // Run alongside the transcription call rather than inside it. This is a
    // pure pixel measurement (lib/typesize.ts): the model is not asked how big
    // anything is, and no prompt or extraction schema knows this check exists.
    // See docs/TYPE-SIZE-FEASIBILITY.md for the two model-based attempts that
    // failed, and NFR-5 for why measurement never moves into the prompt.
    const [label, typeSize] = await Promise.all([
      extractLabel(base64, image.type),
      // Never allowed to take the whole verification down with it. The other
      // five checks are useful on their own, and this one degrades to the
      // "not assessed" it already has a representation for.
      measureWarningTypeSize(bytes, parsedWidthMm).catch(
        (error): TypeSizeResult => {
          console.error("Type-size measurement failed:", error);
          return {
            measured: false,
            reason: "image-unreadable",
            detail: "The type size could not be measured from this image.",
          };
        },
      ),
    ]);
    return NextResponse.json(
      verify(submission, label, Date.now() - started, typeSize),
    );
  } catch (error) {
    // Log the real cause for operators; show agents something actionable.
    console.error("Verification failed:", error);
    const { message, status } = describeFailure(error);
    return NextResponse.json({ error: message }, { status });
  }
}
