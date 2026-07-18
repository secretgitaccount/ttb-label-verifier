/**
 * The single seam between this application and whatever reads a label image.
 *
 * Callers import `extractLabel` from here and never name a provider. The
 * implementations live in lib/providers/; this module only chooses between
 * them. Compliance judgements live in lib/compare.ts and nowhere else
 * (PRD NFR-5).
 *
 * Selection is by `EXTRACTION_PROVIDER`, defaulting to `anthropic` — the only
 * provider that has been observed working. See docs/MIGRATION.md.
 */

import type { ExtractedLabel } from "./types.ts";
import type { LabelExtractor, SupportedMediaType } from "./providers/contract.ts";
import * as anthropic from "./providers/anthropic.ts";
import * as azure from "./providers/azure.ts";

export {
  SUPPORTED_MEDIA_TYPES,
  isSupportedMediaType,
  validateExtractedLabel,
} from "./providers/contract.ts";
export type { SupportedMediaType, LabelExtractor } from "./providers/contract.ts";

/**
 * Statically imported rather than lazily loaded: both modules are side-effect
 * free at import time (the Anthropic client is constructed on first use, and
 * the Azure adapter reads its config inside the call), so there is nothing to
 * defer. `azure` adds no runtime dependency — it is plain `fetch`.
 */
const PROVIDERS: Record<string, LabelExtractor> = {
  anthropic: anthropic.extractLabel,
  azure: azure.extractLabel,
};

export const DEFAULT_PROVIDER = "anthropic";

/**
 * Resolves a provider name to its implementation. Exported for tests.
 *
 * An unknown name is a deployment error, not a user error, so it fails loudly
 * rather than silently falling back to the default — a typo in
 * `EXTRACTION_PROVIDER` that quietly kept calling api.anthropic.com is exactly
 * the failure the firewall work is meant to make impossible to miss.
 */
export function selectExtractor(name: string | undefined): LabelExtractor {
  const key = (name ?? DEFAULT_PROVIDER).trim().toLowerCase() || DEFAULT_PROVIDER;
  const extractor = PROVIDERS[key];
  if (!extractor) {
    throw new Error(
      `Unknown EXTRACTION_PROVIDER "${key}". Available: ${Object.keys(PROVIDERS)
        .sort()
        .join(", ")}.`,
    );
  }
  return extractor;
}

/**
 * Read at call time rather than module load so a test (or a redeploy that
 * changes the variable) is not fighting import order.
 */
export function extractLabel(
  imageBase64: string,
  mediaType: SupportedMediaType,
): Promise<ExtractedLabel> {
  return selectExtractor(process.env.EXTRACTION_PROVIDER)(imageBase64, mediaType);
}
