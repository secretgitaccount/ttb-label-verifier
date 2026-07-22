/**
 * Transcription eval — `npm run eval`.
 *
 * Scores the vision model's reading of each fixture against ground truth, in
 * two tiers:
 *
 *   Tier 1 (diagnostic): field-level transcription fidelity. Reported both
 *   exact and normalized, because the two answer different questions. Exact
 *   surfaces things the system tolerates but is worth watching — e.g. the model
 *   title-casing "OLD TOM DISTILLERY". Normalized reflects what compare.ts
 *   actually acts on.
 *
 *   Tier 2 (the gate): does the transcription drive the correct compliance
 *   verdict? This is the number that matters, because it is what the product
 *   guarantees. A non-zero exit means the model regressed the verdict on a case
 *   it used to get right — the signal you want when the model version changes
 *   under you.
 *
 * This makes real API calls (one per case per run) and needs a key. It reads
 * .env.local the way scripts/smoke-test.mjs does. Budget: 8 cases x runs.
 *
 * Why this exists: the model is a dependency we do not control. Sonnet 5 will be
 * updated or retired, and transcription behaviour can shift with no change on
 * our side. The unit suite tests the deterministic logic; this tests the part
 * that can move on its own.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Load .env.local into the environment BEFORE the provider constructs its
// client (which happens lazily on the first extractLabel call).
const envPath = new URL("../.env.local", import.meta.url);
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "No ANTHROPIC_API_KEY found (checked the environment and .env.local).\n" +
      "The eval makes real model calls; set the key and re-run.",
  );
  process.exit(1);
}

const { extractLabel } = await import("../lib/providers/anthropic.ts");
const { verify, normalize } = await import("../lib/compare.ts");
const { collapseWhitespace } = await import("../lib/warning.ts");
const { getObservabilitySummary } = await import("../lib/observability.ts");
const { CASES } = await import("./ground-truth.ts");
import type { ExpectedTranscription } from "./ground-truth.ts";
import type { ExtractedLabel } from "../lib/types.ts";

const RUNS = Math.max(1, Number(argValue("--runs") ?? "1"));
const SAMPLES = fileURLToPath(new URL("../samples/", import.meta.url));

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

/** The transcription fields, and how "normalized equality" is judged for each. */
const STRING_FIELDS: {
  key: keyof ExpectedTranscription;
  label: string;
  read: (l: ExtractedLabel) => string | null;
  norm: (s: string) => string;
}[] = [
  { key: "brandName", label: "brandName", read: (l) => l.brandName, norm: normalize },
  { key: "classType", label: "classType", read: (l) => l.classType, norm: normalize },
  { key: "alcoholContent", label: "alcoholContent", read: (l) => l.alcoholContent, norm: normalize },
  { key: "netContents", label: "netContents", read: (l) => l.netContents, norm: normalize },
  { key: "bottlerAddress", label: "bottlerAddress", read: (l) => l.bottlerAddress, norm: normalize },
  { key: "countryOfOrigin", label: "countryOfOrigin", read: (l) => l.countryOfOrigin, norm: normalize },
  // The warning is scored on collapsed whitespace, matching how compare.ts
  // compares it against the statute (line breaks in artwork do not matter).
  { key: "warningText", label: "warning.text", read: (l) => l.governmentWarning.text, norm: collapseWhitespace },
];

const BOOL_FIELDS: {
  key: keyof ExpectedTranscription;
  label: string;
  read: (l: ExtractedLabel) => boolean | null;
}[] = [
  { key: "headingAllCaps", label: "warning.allCaps", read: (l) => l.governmentWarning.headingAllCaps },
  { key: "headingBold", label: "warning.bold", read: (l) => l.governmentWarning.headingBold },
];

interface Tally { exact: number; normalized: number; total: number }
const fieldTally = new Map<string, Tally>();
function tally(label: string): Tally {
  let t = fieldTally.get(label);
  if (!t) fieldTally.set(label, (t = { exact: 0, normalized: 0, total: 0 }));
  return t;
}

interface VerdictRow { fixture: string; expected: string; got: string; ok: boolean }
const verdictRows: VerdictRow[] = [];
let verdictPass = 0;
let verdictTotal = 0;
const errors: string[] = [];

function eqString(expected: string | null, got: string | null, norm: (s: string) => string) {
  const exact = expected === got;
  const normalized =
    expected === null || got === null
      ? expected === got
      : norm(expected) === norm(got);
  return { exact, normalized };
}

console.log(
  `\nTranscription eval — ${CASES.length} fixtures x ${RUNS} run${RUNS > 1 ? "s" : ""} ` +
    `= ${CASES.length * RUNS} model calls\n`,
);

for (const testCase of CASES) {
  const imagePath = `${SAMPLES}${testCase.fixture}`;
  const base64 = readFileSync(imagePath).toString("base64");

  for (let run = 0; run < RUNS; run++) {
    let label: ExtractedLabel;
    try {
      label = await extractLabel(base64, "image/png");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${testCase.fixture}: ${message}`);
      verdictTotal++;
      verdictRows.push({ fixture: testCase.fixture, expected: testCase.expectedVerdict, got: "ERROR", ok: false });
      continue;
    }

    // Tier 1 — field fidelity.
    for (const field of STRING_FIELDS) {
      const t = tally(field.label);
      const { exact, normalized } = eqString(
        testCase.expected[field.key] as string | null,
        field.read(label),
        field.norm,
      );
      t.total++;
      if (exact) t.exact++;
      if (normalized) t.normalized++;
    }
    for (const field of BOOL_FIELDS) {
      const t = tally(field.label);
      const match = testCase.expected[field.key] === field.read(label);
      t.total++;
      if (match) t.exact++;
      if (match) t.normalized++;
    }

    // Tier 2 — the gate. Transcription-driven verdict, type size excluded.
    const result = verify(testCase.application, label, 0);
    const ok = result.verdict === testCase.expectedVerdict;
    verdictTotal++;
    if (ok) verdictPass++;
    verdictRows.push({ fixture: testCase.fixture, expected: testCase.expectedVerdict, got: result.verdict, ok });
  }
}

// ---- Report -------------------------------------------------------------

const pad = (s: string, n: number) => s.padEnd(n);

console.log("Tier 2 — end-to-end verdict (the gate)");
console.log("  " + pad("fixture", 26) + pad("expected", 10) + pad("got", 10) + "ok");
for (const row of verdictRows) {
  console.log(
    "  " + pad(row.fixture, 26) + pad(row.expected, 10) + pad(row.got, 10) + (row.ok ? "yes" : "NO  <—"),
  );
}
const verdictPct = verdictTotal ? Math.round((verdictPass / verdictTotal) * 100) : 0;
console.log(`  verdict accuracy: ${verdictPass}/${verdictTotal} (${verdictPct}%)\n`);

console.log("Tier 1 — transcription fidelity (diagnostic)");
console.log("  " + pad("field", 18) + pad("exact", 12) + "normalized");
for (const [label, t] of fieldTally) {
  const exactStr = `${t.exact}/${t.total}`;
  const normStr = `${t.normalized}/${t.total}`;
  const flag = t.exact < t.total && t.normalized === t.total ? "  (tolerated: styling only)" : t.exact < t.total ? "  <— review" : "";
  console.log("  " + pad(label, 18) + pad(exactStr, 12) + pad(normStr, 12) + flag);
}

if (errors.length) {
  console.log("\nErrors:");
  for (const e of errors) console.log("  " + e);
}

const cost = getObservabilitySummary();
console.log("\nCost & latency (this run)");
console.log(`  calls:   ${cost.count}`);
console.log(`  tokens:  ${cost.tokens.input} in / ${cost.tokens.output} out`);
console.log(`  cost:    $${cost.totalCostUsd.toFixed(4)} total, $${cost.avgCostUsd.toFixed(4)}/label`);
console.log(`  latency: p50 ${(cost.latencyMs.p50 / 1000).toFixed(2)}s, p95 ${(cost.latencyMs.p95 / 1000).toFixed(2)}s, max ${(cost.latencyMs.max / 1000).toFixed(2)}s`);

// ---- Gate ---------------------------------------------------------------

const passed = verdictPass === verdictTotal && errors.length === 0;
console.log(
  `\n${passed ? "PASS" : "FAIL"} — verdict gate ${passed ? "met" : "not met"} ` +
    `(${verdictPass}/${verdictTotal} correct)\n`,
);
process.exit(passed ? 0 : 1);
