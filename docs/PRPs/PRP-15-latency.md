# PRP-15 — Re-measure and minimise latency

**Requirement:** NFR-1 · **Priority:** P0 · **Blocks submission:** yes

## Problem
The README quotes 3.80–4.26s in three places. Those numbers predate the output
schema change. Current measured range is 4.19–4.66s — the added schema fields
cost roughly 0.3s of output generation. The figure is load-bearing against a
requirement the brief treats as hard.

## Scope
Own: measurement, and `lib/extract.ts` ONLY if you find a safe win.
Do not touch `README.md` (PRP-14 owns it) — report numbers instead.

## Do
1. Measure current per-fixture latency, 3 runs each on `old-tom` and
   `title-case-warning`. Report median and max. Budget: 6 API calls.
2. Investigate reductions that do NOT trade correctness:
   - `max_tokens` is 2048; the real ceiling is far lower. Measure whether
     lowering it changes latency at all (it usually does not — it caps, it does
     not shorten generation) and say so honestly either way.
   - Schema field count directly affects output length. Quantify the cost of the
     optional fields if you can do so without editing them.
   - Server-side downscaling for the API path (the browser already downscales;
     `scripts/smoke-test.mjs` does not).
3. Do NOT reduce latency by removing the verbatim warning transcription. It is
   what makes the exact-match check auditable. Flag it as the floor, not a target.

## Acceptance criteria
- Current median and max latency reported for both fixtures
- Any change keeps all fixtures at their expected verdicts
- If no safe win exists, say so — "already near the floor" is a valid result

## Report
Before/after numbers, what you changed, what you rejected and why.
