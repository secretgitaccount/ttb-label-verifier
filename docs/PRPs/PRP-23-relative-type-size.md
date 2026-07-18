# PRP-23 — Relative type-size detector

**Requirement:** FR-10 (partial) · **Priority:** P2 · **Feasibility: UNPROVEN**

## Why this, and not absolute measurement
`docs/TYPE-SIZE-FEASIBILITY.md` rejected absolute mm measurement: the model's
vertical extent carries a stable +22% bias that flips sign with resolution, and
±30–40% total error cannot resolve a 20% decision band.

This PRP tests a different hypothesis: **a stable bias largely cancels in a
ratio.** If the warning cap height and a reference text's cap height are both
over-read by a similar factor, warning÷reference is far more accurate than
either. The very stability that made absolute measurement untrustworthy is what
would make a ratio work.

This does NOT measure compliance with 27 CFR 16.22, which is written in
millimetres. It detects the abuse Jenny Park described — a warning set far
smaller than the rest of the label — without needing any physical scale.

## Phase 1 — feasibility (REPORT BEFORE BUILDING)
Ground truth is computable here, unlike last time: fixtures are rendered from
HTML in `scripts/make-samples.mjs` with known CSS (`.warning` 11.5px,
`.class` 25px, `.brand` 46px). Decode fixture pixels directly to establish true
cap heights, exactly as the previous study did.

Test: ask for the warning's cap height AND the class/type text's cap height in
pixels, purely perceptually. Run >=3 times on `old-tom.png`.

Report:
- absolute error on each measurement (expect ~+22%, matching the prior study)
- **error on the RATIO** — the number that decides this
- ratio stability across runs

Recommend BUILD only if ratio error is under ~15% and stable. Otherwise
DO_NOT_BUILD and say so; a negative result is a valid outcome and cheaper than
a detector nobody can trust.

## Phase 2 — build (only if phase 1 passes)
1. Extraction returns two pixel measurements. Purely perceptual — never ask
   whether the size is adequate, required, or compliant.
2. `compare.ts` computes the ratio and applies the threshold. All arithmetic
   and every judgement lives in code.
3. Add a fixture `tiny-warning.png`: identical to `old-tom` but with the warning
   at roughly 5px against the same 25px class text, so the detector has a true
   positive to catch.

## Non-negotiable constraints
- **This NEVER affects the verdict.** Not PASS, not FAIL, not REVIEW. It renders
  as an informational note beside the warning field. A wrong "looks fine" must
  not be able to approve a label, and a wrong "looks small" must not be able to
  reject one.
- Wording must convey that it is an estimate and that physical measurement
  settles it. Never state or imply a millimetre value.
- If either measurement is missing, render nothing. No guessing.

## Acceptance
- Phase 1 reported either way, with computed ground truth
- If built: `tiny-warning` is flagged, `old-tom` is not, and neither label's
  verdict changes because of this feature
- Latency re-measured at n=10 after the change and reported honestly
- Budget: 8 API calls total
