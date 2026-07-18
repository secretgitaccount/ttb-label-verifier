#!/usr/bin/env node
/**
 * End-to-end check against a running server. Confirms the API key works, the
 * model returns a parseable transcription, and the round trip fits the 5-second
 * budget agents actually care about.
 *
 * Usage:
 *   node scripts/smoke-test.mjs <image> [--url http://localhost:3000] \
 *     [--brand "OLD TOM DISTILLERY"] [--class "..."] [--abv "..."] [--net "..."]
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const args = process.argv.slice(2);
const imagePath = args.find((arg) => !arg.startsWith("--"));

if (!imagePath) {
  console.error("Usage: node scripts/smoke-test.mjs <image> [--url ...]");
  process.exit(1);
}

function flag(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
}

const baseUrl = flag("url", "http://localhost:3000");

const EXTENSION_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

const extension = imagePath.split(".").pop()?.toLowerCase() ?? "";
const mediaType = EXTENSION_TYPES[extension];
if (!mediaType) {
  console.error(`Unsupported image extension ".${extension}".`);
  process.exit(1);
}

const form = new FormData();
form.append(
  "image",
  new Blob([await readFile(imagePath)], { type: mediaType }),
  basename(imagePath),
);
form.append("brandName", flag("brand", "OLD TOM DISTILLERY"));
form.append("classType", flag("class", "Kentucky Straight Bourbon Whiskey"));
form.append("alcoholContent", flag("abv", "45% Alc./Vol. (90 Proof)"));
form.append("netContents", flag("net", "750 mL"));

// Optional TTB elements. Sent only when supplied — an empty value would assert
// a claim the application never made. See lib/compare.ts.
const bottler = flag("bottler", null);
const origin = flag("origin", null);
if (bottler) form.append("bottlerAddress", bottler);
if (origin) form.append("countryOfOrigin", origin);

const started = Date.now();
const response = await fetch(`${baseUrl}/api/verify`, { method: "POST", body: form });
const elapsed = Date.now() - started;

// A hosting proxy can answer with plain text (e.g. "upstream error" while a
// container restarts). Report that as what it is rather than dying in JSON.parse.
const body = await response.text();
let payload;
try {
  payload = JSON.parse(body);
} catch {
  console.error(`✗ HTTP ${response.status}: non-JSON response from ${baseUrl}`);
  console.error(`  ${body.slice(0, 200)}`);
  console.error("  If deploying, the instance may still be restarting — retry shortly.");
  process.exit(1);
}

if (!response.ok) {
  console.error(`✗ HTTP ${response.status}: ${payload.error}`);
  process.exit(1);
}

console.log(`\nOverall: ${payload.verdict}`);
for (const field of payload.fields) {
  const mark = field.verdict === "PASS" ? "✓" : field.verdict === "REVIEW" ? "?" : "✗";
  console.log(`  ${mark} ${field.title}: ${field.reason}`);
}
if (!payload.imageQuality.readable) {
  console.log(`  ! Image quality: ${payload.imageQuality.issues.join("; ")}`);
}

console.log(
  `\nRound trip: ${(elapsed / 1000).toFixed(2)}s (server ${(payload.elapsedMs / 1000).toFixed(2)}s)`,
);
if (elapsed > 5000) {
  console.log("⚠  Over the 5-second target agents said they need.");
}
