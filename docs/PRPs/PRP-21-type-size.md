# PRP-21 — Warning type-size assessment

**Requirement:** FR-10 · **Priority:** P2 · **Feasibility: UNPROVEN**

## Problem
27 CFR 16.22 sets a minimum type size in MILLIMETRES, scaled by container
volume (≤237mL: 1mm; 237mL–3L: 2mm; >3L: 3mm). A photograph has no inherent
scale, so millimetres cannot be derived from pixels alone.

## Phase 1 — feasibility (do this FIRST, report before building)
Establish empirically whether the model returns a usable bounding box for the
warning text on our fixtures. If it does not, or the boxes are not reproducible
across runs, STOP and report that FR-10 is not implementable this way. A negative
result is a valid, valuable outcome. Do not proceed to phase 2 on a shaky signal.

## Phase 2 — only if phase 1 succeeds
1. Extract the warning text bounding box (pixels) alongside the transcription.
2. Add an OPTIONAL application input: the label's physical width in millimetres.
3. Compute mm-per-pixel from that width and the image width, then derive the
   warning's cap height in mm.
4. Compare against the threshold for the stated net contents.

## Non-negotiable honesty constraints
- If no physical dimension is supplied, the field reports "not assessed". It must
  NOT guess a scale and it must NOT fail the label.
- A measurement within 20% of the threshold reports REVIEW, not FAIL. Photographic
  measurement is not precise enough to reject an application on a near-miss.
- A confident FAIL is permitted only when the measurement is clearly under the
  threshold AND the scale was supplied by the applicant.
- The mm arithmetic lives in compare.ts. The model returns pixels only — it is
  never asked whether the type size is compliant.

## Acceptance
- Phase 1 result reported either way, with evidence
- If built: no scale supplied => "not assessed", never a failure
- Reproducibility of the bounding box across >=3 runs reported honestly
- Budget: 6 API calls
