/**
 * Reads label artwork with Claude's vision model and returns a verbatim
 * transcription. This module deliberately makes no compliance judgements —
 * see lib/compare.ts for that.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ExtractedLabel } from "./types.ts";

/**
 * Constructed on first use rather than at import time: the SDK throws when no
 * API key is present, which would make this module impossible to import from a
 * unit test that only exercises the validator.
 */
let client: Anthropic | undefined;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

/**
 * Transcription is a perception task, so the cheapest model that reads small
 * print reliably wins — the 5-second budget is a hard requirement and Opus
 * measured too slow for it. Override to re-benchmark without a code change.
 */
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";

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

const SYSTEM_PROMPT = `You transcribe alcohol beverage label artwork for TTB compliance agents.

Report only what is printed on the label. Do not correct spelling, expand
abbreviations, fix capitalization, or infer values that are not visible. If a
field is not on the label, return null for it — do not guess.

The government warning must be transcribed character-for-character, including
any misspellings, omissions, or altered wording. Reproducing it from memory
instead of reading it defeats the purpose of the check.

governmentWarning.text must start with the heading and run to the end of the
statement, as one continuous string — begin it with "GOVERNMENT WARNING:" (or
whatever capitalization is actually printed) and continue through "...may cause
health problems." Labels usually set the heading in bold, but bold is still
part of the text: do not drop it, and do not begin the transcription at "(1)".

Set governmentWarning.headingAllCaps by looking at how the heading is actually
printed: true only if "GOVERNMENT WARNING:" appears in full capital letters.

Set governmentWarning.headingBold by looking at the weight of the type: true if
the heading is printed in noticeably heavier strokes than the sentences that
follow it, false if it is the same weight as that body text. If the artwork is
too small, too blurry, or too stylised for you to tell the two apart, return
null. Do not guess — null is the correct answer when you cannot see the
difference.


Set imageQuality.readable to false only when glare, blur, angle, or resolution
genuinely prevent you from reading part of the label. A photograph taken at an
angle or in poor light is still readable if you can make out the text.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    brandName: {
      type: ["string", "null"],
      description: "The brand name as printed, or null if absent.",
    },
    classType: {
      type: ["string", "null"],
      description:
        'The class/type designation, e.g. "Kentucky Straight Bourbon Whiskey".',
    },
    alcoholContent: {
      type: ["string", "null"],
      description:
        'The full alcohol content statement as printed, e.g. "45% Alc./Vol. (90 Proof)".',
    },
    netContents: {
      type: ["string", "null"],
      description: 'The net contents statement as printed, e.g. "750 mL".',
    },
    governmentWarning: {
      type: "object",
      properties: {
        present: { type: "boolean" },
        text: {
          type: ["string", "null"],
          description:
            "Verbatim transcription of the entire warning, exactly as printed, " +
            'starting with the "GOVERNMENT WARNING:" heading (bold counts) and ' +
            'ending with "may cause health problems." Never start at "(1)".',
        },
        headingAllCaps: {
          type: ["boolean", "null"],
          description: 'True only if "GOVERNMENT WARNING:" is printed in all capitals.',
        },
        headingBold: {
          type: ["boolean", "null"],
          description:
            'True if the "GOVERNMENT WARNING:" heading is printed in noticeably ' +
            "heavier type than the sentences that follow it, false if it is the " +
            "same weight, null if the artwork is too small or unclear to tell.",
        },
      },
      required: ["present", "text", "headingAllCaps", "headingBold"],
      additionalProperties: false,
    },
    imageQuality: {
      type: "object",
      properties: {
        readable: { type: "boolean" },
        issues: {
          type: "array",
          items: { type: "string" },
          description: 'Short phrases, e.g. "glare on lower third", "photographed at an angle".',
        },
      },
      required: ["readable", "issues"],
      additionalProperties: false,
    },
  },
  required: [
    "brandName",
    "classType",
    "alcoholContent",
    "netContents",
    "governmentWarning",
    "imageQuality",
  ],
  additionalProperties: false,
} as const;

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
 * Narrows a parsed model response to ExtractedLabel, or throws an Error whose
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

export async function extractLabel(
  imageBase64: string,
  mediaType: SupportedMediaType,
): Promise<ExtractedLabel> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    // Transcription is a perception task, not a reasoning one. Agents abandoned
    // the last vendor's tool at 30-40s, so we spend the latency budget on
    // reading the image rather than deliberating about it.
    thinking: { type: "disabled" },
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: "Transcribe this label." },
        ],
      },
    ],
  });

  if (response.stop_reason === "max_tokens") {
    throw new Error(
      "The label transcription was cut off before completing. The artwork may contain an unusually large amount of text.",
    );
  }

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("The model returned no transcription for this image.");
  }

  return validateExtractedLabel(JSON.parse(textBlock.text));
}
