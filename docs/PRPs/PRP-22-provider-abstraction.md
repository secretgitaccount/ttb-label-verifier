# PRP-22 — Provider abstraction and Azure adapter

**Requirement:** NFR-7 · **Priority:** P1 · **Partially unverifiable**

## Problem
TTB's network blocks external ML endpoints. `lib/extract.ts` calls
api.anthropic.com directly. docs/MIGRATION.md describes swapping it; make the
seam real rather than notional.

## Scope
lib/extract.ts, new lib/providers/, test/

## Do
1. Define a `LabelExtractor` interface: `(imageBase64, mediaType) => Promise<ExtractedLabel>`.
2. Move the current implementation to `lib/providers/anthropic.ts` unchanged.
3. Select the provider by env var (`EXTRACTION_PROVIDER`, default `anthropic`).
4. Add `lib/providers/azure.ts`: a code-complete adapter for Azure AI Document
   Intelligence that returns the same `ExtractedLabel` shape.

## MANDATORY honesty requirements
- You CANNOT test the Azure adapter — there is no account and no network access.
  Do not claim it works. Put a header comment at the top of azure.ts stating
  plainly that it is unverified, has never executed against the service, and
  requires validation before use.
- Document the REGRESSION this swap causes: OCR does not reliably report font
  weight, so `headingBold` cannot be populated from Azure. It must return null,
  which routes to REVIEW via the existing uncertainty path — meaning every label
  needs a human to check bold. Say this in the adapter AND in docs/MIGRATION.md.
  This is a genuine capability loss, not a footnote.
- If the Azure SDK's exact API surface is not known to you with confidence, write
  the adapter against the documented REST shape and say which parts are inferred.
  Guessing method names and presenting them as fact is worse than saying so.

## Acceptance
- Anthropic path is behaviourally identical; all existing tests pass unchanged
- Provider selection works and defaults to anthropic
- Azure adapter clearly marked unverified, with the bold regression documented
- No new runtime dependency added for the default path
- Budget: 0 API calls beyond a single regression check on the anthropic path
