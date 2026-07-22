# Evals and observation

Two things the deterministic unit suite can't cover, because the model is a
dependency we don't control: **is it still reading labels correctly**, and
**what is it costing**.

## Run the eval

```bash
npm run eval           # 8 fixtures, 1 call each
npm run eval -- --runs 3   # 3 calls each, to see run-to-run variance
```

Needs an `ANTHROPIC_API_KEY` (read from `.env.local`, same as the app). It makes
real model calls — budget is `fixtures × runs`, about eight cents at the default.

### What it reports

- **Tier 2 — end-to-end verdict (the gate).** For each fixture it runs the
  model's transcription through `verify()` and checks the overall compliance
  verdict against ground truth. A wrong verdict exits non-zero. This is the
  number that matters, because it is what the product guarantees, and it is the
  signal you want the day a new model version reads a label differently.
- **Tier 1 — transcription fidelity (diagnostic).** Field-by-field accuracy,
  reported both *exact* and *normalized*. The split is deliberate: exact
  surfaces things the system tolerates but are worth watching — the model
  title-cases `OLD TOM DISTILLERY`, so `brandName` shows a lower exact score
  than normalized — while normalized reflects what `compare.ts` actually acts
  on. Hiding that gap would make the eval less honest, not more.
- **Cost & latency** for the run, from the same accounting the live app uses.

Type size is **not** evaluated here. It is a deterministic pixel measurement
(`lib/typesize.ts`), not a model output, and has its own unit coverage. A model
eval measures the model.

## Observe cost live

Every model call the running app makes is recorded (`lib/observability.ts`):

- a structured JSON trace line per call in the server log, and
- a running aggregate at **`GET /api/observability`** — check a few labels in
  the browser, then open that endpoint to see calls, tokens, dollars, and
  latency percentiles.

The aggregate is in-memory and per-instance; it resets on restart, which the
payload's `note` field states. In production this module is the seam where a
Langfuse or OpenTelemetry exporter would attach — kept as a plain module here so
it runs with no account.

## The honest limit

Every fixture is a clean synthetic render. This proves the pipeline and catches
regressions when the model moves under us. It is **not** evidence about real
photographs — for that the eval needs a hand-labelled set of real labels, which
is the one dataset this repository still lacks and the first thing worth adding
next.
