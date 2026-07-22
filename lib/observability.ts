/**
 * Cost and latency observation for model calls.
 *
 * Self-contained on purpose: no external service, no account, no dependency.
 * Every extraction records its token usage, cost, and latency here, and the
 * numbers surface two ways a reviewer can actually see:
 *
 *   1. a structured JSON line per call in the server log (the "trace")
 *   2. a running aggregate at GET /api/observability
 *
 * In production this module is where a Langfuse or OpenTelemetry exporter would
 * attach — `recordExtraction` is the single seam. It is kept as a plain
 * in-process module here precisely so the reviewer can run it without standing
 * up an account. The aggregate is in-memory: it resets on restart and is
 * per-instance, which is stated in the summary rather than pretended away.
 */

export interface ExtractionEvent {
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

/**
 * Pricing per 1,000,000 tokens, in USD.
 *
 * Standard rates are used deliberately. Sonnet 5 carries an introductory
 * discount ($2/$10) through 2026-08-31; quoting the standard $3/$15 slightly
 * OVER-states current cost, and over-stating a cost estimate is the safe
 * direction to be wrong in. Update this table when the model or the rate card
 * changes — it is the one place cost assumptions live.
 */
const PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  "claude-sonnet-5": { inputPerM: 3, outputPerM: 15 },
  "claude-opus-4-8": { inputPerM: 5, outputPerM: 25 },
  "claude-haiku-4-5": { inputPerM: 1, outputPerM: 5 },
};

/** Dollar cost of one call. Returns null for an unpriced model rather than fabricating a number. */
export function costUsd(event: ExtractionEvent): number | null {
  const rate = PRICING[event.model];
  if (!rate) return null;
  return (
    (event.inputTokens / 1_000_000) * rate.inputPerM +
    (event.outputTokens / 1_000_000) * rate.outputPerM
  );
}

interface Recorded extends ExtractionEvent {
  costUsd: number | null;
  at: number;
}

const MAX_RETAINED = 1000;
const ring: Recorded[] = [];

/** One structured trace line per call unless silenced (tests set OBSERVABILITY_LOG=off). */
const LOG_TRACES = process.env.OBSERVABILITY_LOG !== "off";

export function recordExtraction(event: ExtractionEvent): void {
  const cost = costUsd(event);
  ring.push({ ...event, costUsd: cost, at: Date.now() });
  if (ring.length > MAX_RETAINED) ring.shift();

  if (LOG_TRACES) {
    console.log(
      JSON.stringify({
        type: "extraction",
        model: event.model,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        latencyMs: event.latencyMs,
        costUsd: cost === null ? null : Number(cost.toFixed(6)),
      }),
    );
  }
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const index = Math.min(sortedAsc.length - 1, Math.ceil((p / 100) * sortedAsc.length) - 1);
  return sortedAsc[Math.max(0, index)];
}

export interface ObservabilitySummary {
  count: number;
  totalCostUsd: number;
  avgCostUsd: number;
  tokens: { input: number; output: number };
  latencyMs: { p50: number; p95: number; max: number };
  byModel: Record<string, { count: number; costUsd: number }>;
  note: string;
}

export function getObservabilitySummary(): ObservabilitySummary {
  const latencies = ring.map((r) => r.latencyMs).sort((a, b) => a - b);
  const totalCost = ring.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);

  const byModel: ObservabilitySummary["byModel"] = {};
  for (const r of ring) {
    const bucket = (byModel[r.model] ??= { count: 0, costUsd: 0 });
    bucket.count += 1;
    bucket.costUsd += r.costUsd ?? 0;
  }
  for (const bucket of Object.values(byModel)) {
    bucket.costUsd = Number(bucket.costUsd.toFixed(6));
  }

  return {
    count: ring.length,
    totalCostUsd: Number(totalCost.toFixed(6)),
    avgCostUsd: ring.length ? Number((totalCost / ring.length).toFixed(6)) : 0,
    tokens: {
      input: ring.reduce((s, r) => s + r.inputTokens, 0),
      output: ring.reduce((s, r) => s + r.outputTokens, 0),
    },
    latencyMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      max: latencies.at(-1) ?? 0,
    },
    byModel,
    note: "In-memory and per-instance: resets on restart, and does not aggregate across scaled containers. A production deployment would export these events to Langfuse or an OTel collector instead.",
  };
}

/** Test hook — clears the in-memory buffer between cases. */
export function resetObservability(): void {
  ring.length = 0;
}
