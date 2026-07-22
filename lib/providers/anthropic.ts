/**
 * Reads label artwork with Claude's vision model and returns a verbatim
 * transcription. This module deliberately makes no compliance judgements —
 * see lib/compare.ts for that.
 *
 * This is the default and the only provider that has ever run against a live
 * service. It was moved here from lib/extract.ts unchanged.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ExtractedLabel } from "../types.ts";
import { recordExtraction } from "../observability.ts";
import { validateExtractedLabel, type SupportedMediaType } from "./contract.ts";

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

bottlerAddress is the bottler's or producer's name and address as printed
(e.g. "Bottled by Old Tom Distillery, Bardstown, KY"). countryOfOrigin is a
statement such as "Product of Scotland". Return null for either one if it does
not appear on the label; most domestic labels do not carry a country of origin.

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
    bottlerAddress: {
      type: ["string", "null"],
      description:
        "The bottler's or producer's name and address as printed, e.g. " +
        '"Bottled by Old Tom Distillery, Bardstown, KY", or null if absent.',
    },
    countryOfOrigin: {
      type: ["string", "null"],
      description:
        'The country of origin statement as printed, e.g. "Product of Scotland". ' +
        "Null if the label does not carry one, which is usual for domestic products.",
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
    "bottlerAddress",
    "countryOfOrigin",
    "governmentWarning",
    "imageQuality",
  ],
  additionalProperties: false,
} as const;

export async function extractLabel(
  imageBase64: string,
  mediaType: SupportedMediaType,
): Promise<ExtractedLabel> {
  const startedAt = Date.now();
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

  // Record cost and latency for every completed model call, before any parsing
  // that might throw. This is the only place the app spends money, so it is the
  // only place worth observing. See lib/observability.ts.
  recordExtraction({
    model: MODEL,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    latencyMs: Date.now() - startedAt,
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
