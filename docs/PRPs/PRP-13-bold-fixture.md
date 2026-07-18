# PRP-13 — Prove bold detection on real artwork

**Requirement:** FR-7 · **Priority:** P0 · **Blocks submission:** yes

## Problem
`compareWarning` fails a label when `headingBold === false`, and unit tests cover
that branch with hand-set booleans. But every fixture in `scripts/make-samples.mjs`
renders the heading with `<b>`, so the model has never actually been asked to
report `false`. The false-approval case FR-7 exists to prevent is unproven.

## Scope
Own: `scripts/make-samples.mjs`, `samples/`.
Do not touch `lib/`, `app/`, `components/`, `README.md`.

## Do
1. Add a fixture `unbolded-warning.png`: identical to `old-tom` in every respect
   except the warning heading is regular weight (`font-weight: 400`) while still
   being ALL CAPS. This isolates bold from capitalisation — the label must be
   caps-correct so a failure can only come from weight.
2. Regenerate fixtures and visually confirm the heading is genuinely lighter.
3. Run it against a local server (`PORT=3061`) with the standard old-tom
   application data. Budget: 3 API calls.

## Acceptance criteria
- `samples/unbolded-warning.png` exists and renders an all-caps, non-bold heading
- The model returns `headingBold: false` for it
- The overall verdict is FAIL, and the reason names bold specifically
- `old-tom.png` still returns `headingBold: true` and PASS (no regression)
- If the model cannot reliably distinguish weight, report that plainly — a
  `null` result is an honest finding about the signal's limits, not a failure to
  be hidden. Do not tune the prompt until it says what you want.

## Report
Exact verdicts and `headingBold` values per run, calls used, and whether the
signal is reliable enough to keep as a hard FAIL.
