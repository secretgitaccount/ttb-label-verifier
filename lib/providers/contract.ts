/**
 * The contract every extraction provider implements.
 *
 * This module is backend-agnostic on purpose: it holds the input types, the
 * `LabelExtractor` signature, and the boundary validator that turns untrusted
 * provider JSON into an `ExtractedLabel`. A new backend inherits the validator
 * for free rather than reimplementing it.
 *
 * It makes no compliance judgements (PRD NFR-5) — see lib/compare.ts.
 */

import type { ExtractedLabel } from "../types.ts";

export const SUPPORTED_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

export type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

export function isSupportedMediaType(value: string): value is SupportedMediaType {
  return (SUPPORTED_MEDIA_TYPES as readonly string[]).includes(value);
}

/**
 * The whole surface between this application and whatever reads an image.
 * Anything that can populate an ExtractedLabel from artwork is a drop-in
 * replacement; nothing downstream knows which provider produced the reading.
 */
export type LabelExtractor = (
  imageBase64: string,
  mediaType: SupportedMediaType,
) => Promise<ExtractedLabel>;

/**
 * Structured outputs make a malformed response unlikely, not impossible, and
 * this is the seam where untrusted model JSON becomes an ExtractedLabel that
 * lib/compare.ts trusts. Validating here means a bad payload fails with one
 * clear sentence instead of surfacing three calls later as a null dereference.
 *
 * Messages are written for the agent reading them: describeFailure in
 * route.ts passes our own Errors through to the screen verbatim.
 */
function malformed(detail: string): Error {
  return new Error(
    `The label was read but the response was not in the expected format (${detail}). Try again.`,
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A field the schema declares as `["string", "null"]`. */
function nullableString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (value === undefined) throw malformed(`${key} is missing`);
  throw malformed(`${key} should be text but was ${typeof value}`);
}

/**
 * Like nullableString, but a missing key reads as null rather than an error.
 * Only correct for fields where "absent from the response" and "absent from the
 * label" carry the same meaning.
 */
function optionalNullableString(
  source: Record<string, unknown>,
  key: string,
): string | null {
  return source[key] === undefined ? null : nullableString(source, key);
}

/** A field the schema declares as `["boolean", "null"]`. */
function nullableBoolean(
  source: Record<string, unknown>,
  path: string,
  key: string,
): boolean | null {
  const value = source[key];
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (value === undefined) throw malformed(`${path}.${key} is missing`);
  throw malformed(`${path}.${key} should be true or false but was ${typeof value}`);
}

/**
 * Narrows a parsed provider response to ExtractedLabel, or throws an Error whose
 * message is already fit to show an agent. Exported for unit testing.
 */
export function validateExtractedLabel(parsed: unknown): ExtractedLabel {
  if (!isPlainObject(parsed)) {
    throw malformed("the response was not an object");
  }

  const warning = parsed.governmentWarning;
  if (warning === undefined) throw malformed("governmentWarning is missing");
  if (!isPlainObject(warning)) throw malformed("governmentWarning was not an object");

  if (typeof warning.present !== "boolean") {
    throw malformed(
      warning.present === undefined
        ? "governmentWarning.present is missing"
        : `governmentWarning.present should be true or false but was ${typeof warning.present}`,
    );
  }

  const quality = parsed.imageQuality;
  if (quality === undefined) throw malformed("imageQuality is missing");
  if (!isPlainObject(quality)) throw malformed("imageQuality was not an object");

  if (typeof quality.readable !== "boolean") {
    throw malformed(
      quality.readable === undefined
        ? "imageQuality.readable is missing"
        : `imageQuality.readable should be true or false but was ${typeof quality.readable}`,
    );
  }

  if (!Array.isArray(quality.issues)) {
    throw malformed(
      quality.issues === undefined
        ? "imageQuality.issues is missing"
        : "imageQuality.issues was not a list",
    );
  }
  if (!quality.issues.every((issue) => typeof issue === "string")) {
    throw malformed("imageQuality.issues contained a non-text entry");
  }

  return {
    brandName: nullableString(parsed, "brandName"),
    classType: nullableString(parsed, "classType"),
    alcoholContent: nullableString(parsed, "alcoholContent"),
    netContents: nullableString(parsed, "netContents"),
    // Absent and null mean the same thing for these two — "no such statement
    // was read off the artwork" — so an omitted key says nothing false and is
    // not worth failing the whole response over. That is not true of the
    // mandatory fields above, where a dropped key hides a real reading.
    bottlerAddress: optionalNullableString(parsed, "bottlerAddress"),
    countryOfOrigin: optionalNullableString(parsed, "countryOfOrigin"),
    governmentWarning: {
      present: warning.present,
      text: nullableString(warning, "text"),
      headingAllCaps: nullableBoolean(warning, "governmentWarning", "headingAllCaps"),
      // An absent bold reading is the uncertain path, not a defect: compare.ts
      // already routes null to REVIEW rather than guessing. Treating it as an
      // error here would reject a response that says nothing false.
      headingBold:
        warning.headingBold === undefined
          ? null
          : nullableBoolean(warning, "governmentWarning", "headingBold"),
    },
    imageQuality: {
      readable: quality.readable,
      issues: quality.issues as string[],
    },
  };
}
