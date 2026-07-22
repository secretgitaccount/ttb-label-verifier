/**
 * Cost accounting and the observation aggregate.
 *
 * The dollar figures a reviewer sees at /api/observability and at the end of an
 * eval run come from here, so the arithmetic is pinned. No network — the pricing
 * math and the summary are pure over recorded events.
 */

// Silence the per-call trace line so it does not interleave with test output.
process.env.OBSERVABILITY_LOG = "off";

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  costUsd,
  recordExtraction,
  getObservabilitySummary,
  resetObservability,
} from "../lib/observability.ts";

test("cost is computed from the per-model rate card", () => {
  // A representative label call: ~2,946 input, ~250 output on Sonnet 5.
  const cost = costUsd({
    model: "claude-sonnet-5",
    inputTokens: 2946,
    outputTokens: 250,
    latencyMs: 4200,
  });
  // (2946/1e6 * $3) + (250/1e6 * $15) = 0.008838 + 0.00375
  assert.ok(cost !== null);
  assert.ok(Math.abs((cost as number) - 0.012588) < 1e-9);
});

test("an unpriced model reports null cost rather than fabricating one", () => {
  const cost = costUsd({
    model: "some-future-model",
    inputTokens: 1000,
    outputTokens: 1000,
    latencyMs: 100,
  });
  assert.equal(cost, null);
});

test("the summary aggregates cost, tokens and latency across calls", () => {
  resetObservability();
  recordExtraction({ model: "claude-sonnet-5", inputTokens: 3000, outputTokens: 200, latencyMs: 4000 });
  recordExtraction({ model: "claude-sonnet-5", inputTokens: 3000, outputTokens: 200, latencyMs: 5000 });

  const s = getObservabilitySummary();
  assert.equal(s.count, 2);
  assert.equal(s.tokens.input, 6000);
  assert.equal(s.tokens.output, 400);
  // Each call: (3000/1e6*3)+(200/1e6*15) = 0.009 + 0.003 = 0.012
  assert.ok(Math.abs(s.totalCostUsd - 0.024) < 1e-6);
  assert.ok(Math.abs(s.avgCostUsd - 0.012) < 1e-6);
  assert.equal(s.byModel["claude-sonnet-5"].count, 2);
  assert.equal(s.latencyMs.max, 5000);
});

test("an unpriced model contributes to counts but not to dollars", () => {
  resetObservability();
  recordExtraction({ model: "mystery-model", inputTokens: 1000, outputTokens: 1000, latencyMs: 100 });
  const s = getObservabilitySummary();
  assert.equal(s.count, 1);
  assert.equal(s.totalCostUsd, 0);
});
