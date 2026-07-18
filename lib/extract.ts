/**
 * Reads label artwork with Claude's vision model and returns a verbatim
 * transcription. This module deliberately makes no compliance judgements —
 * see lib/compare.ts for that.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ExtractedLabel } from "./types.ts";

const client = new Anthropic();

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
      },
      required: ["present", "text", "headingAllCaps"],
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

export async function extractLabel(
  imageBase64: string,
  mediaType: SupportedMediaType,
): Promise<ExtractedLabel> {
  const response = await client.messages.create({
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

  return JSON.parse(textBlock.text) as ExtractedLabel;
}
