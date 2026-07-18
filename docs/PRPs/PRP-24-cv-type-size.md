# PRP-24 — Type-size measurement by classical computer vision

**Requirement:** FR-10 · **Priority:** P1 · **Supersedes:** PRP-21, PRP-23

## Why this succeeds where two model approaches failed
`docs/TYPE-SIZE-FEASIBILITY.md` records both failures. The model cannot measure
metrically: absolute error ±30–40%, and the ratio approach was worse (−27%)
because its vertical bias is anti-correlated between measurements. Both were
*reproducible while wrong*, which is the dangerous combination.

Classical CV replaces estimation with measurement. Thresholding, connected
components and ink-row profiling are deterministic, auditable, and testable
against ground truth. **The model is not involved in this at all** — this runs
server-side on the uploaded pixels, alongside the transcription call rather than
inside it. NFR-5 is therefore untouched: no prompt changes.

## Hard scope boundary
Measure ONLY flat, square-on artwork — which is what most COLA submissions are,
since applicants typically submit the printed artwork file rather than a bottle
photograph.

**Detect and REFUSE anything else.** Perspective can be corrected by homography;
cylindrical curvature on a real bottle cannot, and text near the edges of a
curved label compresses in ways that silently corrupt a measurement. A refusal
is a correct answer. A measurement on a curved label is not.

`samples/stones-throw-tilted.png` is rotated 7° and is the guard fixture: it MUST
be refused, not measured. If it gets measured, the guard does not work.

## Ground truth is computable
Fixtures are rendered from HTML at known CSS sizes, so true cap height in pixels
is derivable and checkable by direct pixel decoding. Use that, not estimation.

**Important finding to account for:** the existing fixtures are NOT compliant.
`old-tom` has a 9px cap height in a 620px-wide label; at a physical width of
100mm that is 1.45mm, under the 2mm minimum for 750mL. The fixture set needs a
genuinely compliant label to test the passing path.

## Thresholds (27 CFR 16.22)
≤237 mL: 1mm · 237mL–3L: 2mm · >3L: 3mm. Derive the applicable threshold from
the net contents already being parsed in `compare.ts`.

## Design
1. New optional application input: **label physical width in mm.** No width
   supplied means the field reports "not assessed" and asserts nothing.
2. Detect the label boundary in pixels (the printed label against its
   background). mm-per-pixel = stated width ÷ detected label pixel width. This
   is the fix for the scale bug that sank PRP-21, which wrongly used image width.
3. Locate the warning text region and measure cap height in pixels.
4. Convert, compare to threshold, in `compare.ts`.

## Verdict bands
- Clearly below threshold (< 0.8×) → **FAIL**
- Within measurement uncertainty of the threshold (0.8×–1.2×) → **REVIEW**
- Clearly above (> 1.2×) → **PASS**
- Cannot establish scale, or distortion detected → **not assessed**, no verdict
  contribution

Justify the band width from the spike's measured error, not from intuition.

## Dependency
`sharp` is already present transitively via Next.js. Add it as a DIRECT
dependency so a Next upgrade cannot silently remove it. No other new dependency.

## Acceptance
- Measures a compliant fixture as compliant and an undersized one as undersized,
  against computed ground truth
- REFUSES `stones-throw-tilted.png` (rotated) rather than measuring it
- Reports "not assessed" when no physical width is supplied — never guesses
- Adds < 300ms to the request; measured, not assumed
- No prompt changes anywhere (NFR-5)
- All existing tests still pass
