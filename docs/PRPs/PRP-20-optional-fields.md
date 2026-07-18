# PRP-20 — Bottler address and country of origin, wired end to end

**Requirement:** FR-8, FR-9 · **Priority:** P1

## Problem
Both were implemented then reverted (OD-1) because nothing could reach them.
Restore them AND wire them through the UI and CSV importer so they are real.

## Recovery
The prior implementation is in git: `git show f47706d -- lib/types.ts lib/compare.ts lib/extract.ts`.
Reuse it rather than rewriting; it was reviewed and unit-tested.

## Scope
lib/types.ts, lib/extract.ts, lib/compare.ts, lib/csv.ts,
components/SingleCheck.tsx, app/api/verify/route.ts, test/, scripts/make-samples.mjs

## Do
1. Restore the types, extraction schema fields, and `compareOptionalText`.
2. `SingleCheck.tsx`: add two inputs labelled optional. They must NOT gate the
   submit button — a domestic spirits application legitimately has neither.
3. `route.ts`: pass them through only when non-empty. Do not add them to the
   required-field validation.
4. `csv.ts`: accept `bottler_address` and `country_of_origin` as OPTIONAL columns.
   `ALL_KEYS` (the required set) stays at five. A manifest without them must
   still parse — verify with the existing `samples/manifest.csv`.
5. Add a fixture `imported-scotch.png` rendering BOTH a bottler address and a
   country-of-origin statement, so extraction is proven not assumed.
6. Prove end to end: the new fixture returns PASS when the application supplies
   matching values, and FAIL when it supplies contradicting ones.

## Design constraint (do not weaken)
"Absent from the label" and "not visible in this photograph" are indistinguishable
from one image. An application-asserted value missing from the artwork is REVIEW,
never FAIL. A value present but contradicting IS a FAIL.

## Acceptance
- Both fields reachable from the manual form and from CSV
- A manifest without the optional columns still parses
- New fixture proves extraction on real artwork
- All existing tests still pass
- Budget: 4 API calls
