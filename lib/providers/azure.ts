/**
 * ============================================================================
 * UNVERIFIED — THIS ADAPTER HAS NEVER EXECUTED AGAINST AZURE.
 * ============================================================================
 *
 * There is no Azure account and no network access to one in this project. The
 * code below is code-complete and type-checked; it is not tested end to end and
 * must not be treated as working software. Nothing here has been observed
 * returning a real result. Validate it against a live resource before use.
 *
 * What IS tested: `mapReadResultToLabel` below is a pure function and is
 * covered by unit tests in test/providers.test.ts against synthetic OCR input.
 * What is NOT tested: every line that touches HTTP — the analyze request, the
 * long-running-operation poll, the response shape, auth, and error handling.
 *
 * ----------------------------------------------------------------------------
 * REGRESSION: `headingBold` (FR-7) CANNOT BE POPULATED BY THIS PROVIDER.
 * ----------------------------------------------------------------------------
 * FR-7 requires verifying that the "GOVERNMENT WARNING:" heading is printed in
 * bold. OCR reports text and geometry; it does not reliably report stroke
 * weight relative to adjacent body text. This adapter therefore returns
 * `headingBold: null` unconditionally.
 *
 * The consequence is not cosmetic. `null` routes through the existing
 * uncertainty path in lib/compare.ts to REVIEW (never PASS, so it is safe —
 * a light-type heading is not silently approved). But it means EVERY label
 * checked through this provider comes back needing a human to eyeball the
 * heading weight. FR-7 was the highest-severity requirement in the PRD
 * precisely because a correctly capitalised heading in light type is a false
 * approval; under this provider the check is handed back to the agent rather
 * than performed. Batch throughput — the entire point of the product — is
 * materially reduced.
 *
 * Possible ways out, none of them implemented or validated here:
 *   - Azure's font/style add-on (`features=styleFont`) is documented to return
 *     `analyzeResult.styles[]` entries carrying `fontWeight: "normal" | "bold"`
 *     over character spans. If it is available for the chosen model, API
 *     version and locale, it could populate this field. I did NOT verify its
 *     availability, its accuracy on label artwork, or its latency cost, so this
 *     adapter does not use it. Treat it as a lead, not a solution.
 *   - Rebuild bold detection from glyph geometry (stroke-thickness ratio in the
 *     rendered pixels). Real work, and its own accuracy problem.
 *   - Downgrade FR-7 to "cannot determine" and accept the agent workload.
 *
 * See docs/MIGRATION.md §3a.
 *
 * ----------------------------------------------------------------------------
 * WHAT IS INFERRED RATHER THAN KNOWN
 * ----------------------------------------------------------------------------
 * This is written against the *documented REST surface* rather than the
 * `@azure-rest/ai-document-intelligence` SDK, deliberately: I do not know that
 * SDK's exact method names with confidence, and guessing them while presenting
 * them as fact would be worse than saying so. Using `fetch` also keeps the
 * default (anthropic) path free of any new runtime dependency.
 *
 * Specifically inferred, and to be checked against current Azure docs:
 *   - The route shape
 *     `POST {endpoint}/documentintelligence/documentModels/{model}:analyze`
 *     and the `api-version` value below. Azure has renamed this path across
 *     versions (the older form was `/formrecognizer/...`); an endpoint on an
 *     older API version will 404 against this.
 *   - The request body key `base64Source` (older versions used `urlSource` or
 *     a raw binary body with a content-type header).
 *   - The async pattern: 202 + `Operation-Location` header, then GET-poll until
 *     `status` is `succeeded` / `failed`. This is the standard Azure LRO
 *     pattern and I am reasonably confident of it, but the exact JSON envelope
 *     (`{ status, analyzeResult }`) should be confirmed.
 *   - Auth via the `Ocp-Apim-Subscription-Key` header. Entra ID / managed
 *     identity is likely what TTB would actually require and is NOT
 *     implemented here.
 *   - `analyzeResult.pages[].lines[].polygon` being an 8-number array of
 *     x,y pairs in the page's declared unit. Used only for relative line
 *     heights, so a unit mismatch is harmless, but a shape mismatch is not.
 *
 * ----------------------------------------------------------------------------
 * NFR-5 note: the mapping below decides which *line of text* a value was read
 * from. It makes no compliance judgement — it does not decide whether any value
 * is correct, required, or a violation. Every verdict still lives in
 * lib/compare.ts. This layer is transcription, in the same role the vision
 * model's prompt plays for the anthropic provider.
 */

import type { ExtractedLabel } from "../types.ts";
import type { SupportedMediaType } from "./contract.ts";

const API_VERSION = process.env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION ?? "2024-11-30";
const MODEL_ID = process.env.AZURE_DOCUMENT_INTELLIGENCE_MODEL ?? "prebuilt-read";

/** How long to poll the long-running operation before giving up. */
const POLL_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;

/**
 * Below the mean OCR word confidence at which we stop claiming the artwork was
 * readable. Arbitrary — it has never been tuned against real labels, because
 * doing so requires the labelled evaluation set that does not exist yet
 * (MIGRATION.md §4.5).
 */
const CONFIDENCE_FLOOR = 0.6;

/** The subset of the documented Analyze response this adapter reads. */
interface AzureLine {
  content: string;
  /** Eight numbers: four x,y corner pairs, clockwise from top-left. */
  polygon?: number[];
}
interface AzureWord {
  content: string;
  confidence?: number;
}
interface AzurePage {
  lines?: AzureLine[];
  words?: AzureWord[];
}
interface AzureAnalyzeResult {
  status?: string;
  error?: { message?: string };
  analyzeResult?: { pages?: AzurePage[] };
}

/* -------------------------------------------------------------------------- */
/* Pure mapping — testable without a network                                   */
/* -------------------------------------------------------------------------- */

/** Vertical extent of a line, or null when no usable polygon was returned. */
function lineHeight(line: AzureLine): number | null {
  const p = line.polygon;
  if (!Array.isArray(p) || p.length < 8) return null;
  const ys = [p[1], p[3], p[5], p[7]].filter((y) => typeof y === "number");
  if (ys.length < 2) return null;
  return Math.max(...ys) - Math.min(...ys);
}

const WARNING_HEADING = /GOVERNMENT\s+WARNING/i;
const WARNING_END = /health\s+problems/i;
const ALCOHOL = /(\d+(?:\.\d+)?\s*%)|(\bproof\b)|(\balc\b)|(\balcohol\s+by\s+volume\b)/i;
const NET_CONTENTS =
  /\b\d+(?:\.\d+)?\s*(ml\b|milliliters?\b|l\b|liters?\b|litres?\b|fl\.?\s*oz\b|pint\b|quart\b)/i;
const ORIGIN = /\b(product|produce)\s+of\b|\bimported\s+from\b/i;
const BOTTLER = /\b(bottled|produced|distilled|blended|imported|packed)\s+(by|for|and\s+bottled)\b/i;
/**
 * Class/type is the weakest heuristic in this adapter. The vision model reads
 * the designation from context; OCR gives an unordered bag of lines, so this
 * falls back to a keyword list that is necessarily incomplete — it covers the
 * distilled-spirits reference case in the PRD and little else. Expect misses on
 * unusual designations; a miss yields null, which compare.ts treats as a
 * missing value rather than a match.
 */
const CLASS_TYPE =
  /\b(whisk(?:e)?y|bourbon|rye|scotch|vodka|gin|rum|tequila|mezcal|brandy|cognac|liqueur|cordial|absinthe|schnapps|wine|champagne|beer|ale|lager|malt\s+beverage|spirits?)\b/i;

/**
 * Turns OCR lines into an ExtractedLabel. Exported so the mapping can be tested
 * without an Azure account; see the header comment for what remains untested.
 *
 * `meanConfidence` is null when the response carried no per-word confidences.
 */
export function mapReadResultToLabel(
  lines: AzureLine[],
  meanConfidence: number | null,
): ExtractedLabel {
  const claimed = new Set<number>();
  const text = lines.map((line) => line.content ?? "");

  /* --- Government warning: a contiguous run of lines, joined verbatim ------ */
  const headingIndex = text.findIndex((line) => WARNING_HEADING.test(line));
  let warningText: string | null = null;
  let headingAllCaps: boolean | null = null;

  if (headingIndex !== -1) {
    // The terminator is matched against the accumulated text, not line by line:
    // OCR breaks lines wherever the artwork does, so "...may cause health" and
    // "problems." routinely land on separate lines and a per-line test would
    // run to the end of the label and swallow unrelated text.
    let endIndex = text.length - 1;
    let accumulated = "";
    for (let i = headingIndex; i < text.length; i++) {
      accumulated += `${text[i]} `;
      if (WARNING_END.test(accumulated)) {
        endIndex = i;
        break;
      }
    }
    for (let i = headingIndex; i <= endIndex; i++) claimed.add(i);
    warningText = text
      .slice(headingIndex, endIndex + 1)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    // Perceptual, not a judgement: report how the heading is printed. Whether
    // all-caps is *required* is compare.ts's call.
    const heading = WARNING_HEADING.exec(text[headingIndex]!)?.[0];
    headingAllCaps = heading ? heading === heading.toUpperCase() : null;
  }

  /** First unclaimed line matching a pattern; claims it on success. */
  function take(pattern: RegExp): string | null {
    for (let i = 0; i < text.length; i++) {
      if (claimed.has(i)) continue;
      if (pattern.test(text[i]!)) {
        claimed.add(i);
        return text[i]!.trim();
      }
    }
    return null;
  }

  const alcoholContent = take(ALCOHOL);
  const netContents = take(NET_CONTENTS);
  const countryOfOrigin = take(ORIGIN);
  const bottlerAddress = take(BOTTLER);
  const classType = take(CLASS_TYPE);

  /*
   * Brand name last, by type size: on label artwork the brand is typically the
   * largest text. This is a perceptual heuristic over the geometry OCR does
   * report, and it is the field most likely to be wrong when a label sets a
   * tagline or the class/type larger than the brand.
   */
  let brandName: string | null = null;
  let tallest = -Infinity;
  for (let i = 0; i < lines.length; i++) {
    if (claimed.has(i)) continue;
    const content = text[i]!.trim();
    if (!content) continue;
    const height = lineHeight(lines[i]!);
    if (height === null) {
      // No geometry at all: fall back to the first unclaimed line.
      if (brandName === null) brandName = content;
      continue;
    }
    if (height > tallest) {
      tallest = height;
      brandName = content;
    }
  }

  const issues: string[] = [];
  if (lines.length === 0) issues.push("no text could be read from the image");
  if (meanConfidence !== null && meanConfidence < CONFIDENCE_FLOOR) {
    issues.push("low optical character recognition confidence");
  }

  return {
    brandName,
    classType,
    alcoholContent,
    netContents,
    bottlerAddress,
    countryOfOrigin,
    governmentWarning: {
      present: headingIndex !== -1,
      text: warningText,
      headingAllCaps,
      // See the REGRESSION block in the header. Not a placeholder to be filled
      // in later by guessing — OCR does not carry this signal, and null is the
      // honest answer. It routes to REVIEW via lib/compare.ts.
      headingBold: null,
    },
    imageQuality: {
      readable: issues.length === 0,
      issues,
    },
  };
}

/** Mean per-word OCR confidence across all pages, or null if none reported. */
export function meanWordConfidence(pages: AzurePage[]): number | null {
  const scores = pages
    .flatMap((page) => page.words ?? [])
    .map((word) => word.confidence)
    .filter((c): c is number => typeof c === "number");
  if (scores.length === 0) return null;
  return scores.reduce((sum, c) => sum + c, 0) / scores.length;
}

/* -------------------------------------------------------------------------- */
/* Transport — NEVER EXECUTED. See header.                                     */
/* -------------------------------------------------------------------------- */

function config(): { endpoint: string; key: string } {
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
  if (!endpoint || !key) {
    throw new Error(
      "The label reading service is not configured. Contact your administrator.",
    );
  }
  return { endpoint: endpoint.replace(/\/+$/, ""), key };
}

async function poll(operationLocation: string, key: string): Promise<AzureAnalyzeResult> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const response = await fetch(operationLocation, {
      headers: { "Ocp-Apim-Subscription-Key": key },
    });
    if (!response.ok) {
      throw new Error("The label reading service could not process this image.");
    }
    const body = (await response.json()) as AzureAnalyzeResult;
    const status = body.status?.toLowerCase();
    if (status === "succeeded") return body;
    if (status === "failed") {
      throw new Error("The label reading service could not process this image.");
    }
  }
  throw new Error("Reading this label took too long. Try again.");
}

/**
 * UNVERIFIED. Never executed against Azure. See the file header before trusting
 * any part of this function.
 *
 * `mediaType` is accepted for interface compatibility and is unused: the
 * documented `base64Source` body carries no content-type, and the service
 * sniffs the format itself. That is itself an inference.
 */
export async function extractLabel(
  imageBase64: string,
  _mediaType: SupportedMediaType,
): Promise<ExtractedLabel> {
  const { endpoint, key } = config();
  const url =
    `${endpoint}/documentintelligence/documentModels/${MODEL_ID}:analyze` +
    `?api-version=${API_VERSION}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Ocp-Apim-Subscription-Key": key,
    },
    body: JSON.stringify({ base64Source: imageBase64 }),
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      "The label reading service rejected our credentials. Contact your administrator.",
    );
  }
  if (response.status === 429) {
    throw new Error("Too many labels at once. Wait a moment and try again.");
  }
  if (!response.ok) {
    throw new Error("The label reading service could not process this image.");
  }

  const operationLocation = response.headers.get("Operation-Location");
  if (!operationLocation) {
    throw new Error("The label reading service returned an unexpected response.");
  }

  const result = await poll(operationLocation, key);
  const pages = result.analyzeResult?.pages ?? [];
  const lines = pages.flatMap((page) => page.lines ?? []);

  return mapReadResultToLabel(lines, meanWordConfidence(pages));
}
