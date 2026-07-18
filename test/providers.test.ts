import assert from "node:assert/strict";
import { test } from "node:test";
import { selectExtractor, DEFAULT_PROVIDER } from "../lib/extract.ts";
import { extractLabel as anthropicExtract } from "../lib/providers/anthropic.ts";
import { extractLabel as azureExtract, mapReadResultToLabel, meanWordConfidence } from "../lib/providers/azure.ts";
import { GOVERNMENT_WARNING } from "../lib/warning.ts";

/* -------------------------------------------------------------------------- */
/* Provider selection                                                          */
/* -------------------------------------------------------------------------- */

test("an unset provider defaults to anthropic", () => {
  assert.equal(selectExtractor(undefined), anthropicExtract);
  assert.equal(DEFAULT_PROVIDER, "anthropic");
});

test("an empty or whitespace provider defaults to anthropic", () => {
  assert.equal(selectExtractor(""), anthropicExtract);
  assert.equal(selectExtractor("   "), anthropicExtract);
});

test("a named provider is selected, case-insensitively", () => {
  assert.equal(selectExtractor("anthropic"), anthropicExtract);
  assert.equal(selectExtractor("azure"), azureExtract);
  assert.equal(selectExtractor("AZURE"), azureExtract);
  assert.equal(selectExtractor(" azure "), azureExtract);
});

test("an unknown provider fails loudly rather than falling back", () => {
  // A typo that silently kept calling api.anthropic.com is the exact failure
  // the firewall work exists to prevent.
  assert.throws(() => selectExtractor("azuer"), /Unknown EXTRACTION_PROVIDER "azuer"/);
  assert.throws(() => selectExtractor("azuer"), /anthropic, azure/);
});

/* -------------------------------------------------------------------------- */
/* Azure mapping                                                               */
/*                                                                             */
/* These exercise the pure OCR-lines -> ExtractedLabel mapping ONLY. Nothing    */
/* here proves the adapter talks to Azure: no request is made, and the HTTP     */
/* half of lib/providers/azure.ts has never executed. See that file's header.   */
/* -------------------------------------------------------------------------- */

/** A line with a synthetic bounding polygon of the given height. */
function line(content: string, height = 10, top = 0) {
  return { content, polygon: [0, top, 100, top, 100, top + height, 0, top + height] };
}

/** OCR output resembling a compliant domestic bourbon label. */
function oldTomLines() {
  return [
    line("OLD TOM DISTILLERY", 40),
    line("Kentucky Straight Bourbon Whiskey", 14),
    line("45% Alc./Vol. (90 Proof)", 10),
    line("750 mL", 10),
    line("Bottled by Old Tom Distillery, Bardstown, KY", 8),
    line(GOVERNMENT_WARNING, 8),
  ];
}

test("azure mapping reads the four application fields off OCR lines", () => {
  const label = mapReadResultToLabel(oldTomLines(), 0.98);
  assert.equal(label.brandName, "OLD TOM DISTILLERY");
  assert.equal(label.classType, "Kentucky Straight Bourbon Whiskey");
  assert.equal(label.alcoholContent, "45% Alc./Vol. (90 Proof)");
  assert.equal(label.netContents, "750 mL");
});

test("azure mapping picks the brand as the largest unclaimed line", () => {
  // Reversed order: position must not decide the brand, type size must.
  const label = mapReadResultToLabel(oldTomLines().reverse(), 0.98);
  assert.equal(label.brandName, "OLD TOM DISTILLERY");
});

test("azure mapping reads the optional bottler and origin statements", () => {
  const label = mapReadResultToLabel(oldTomLines(), 0.98);
  assert.equal(label.bottlerAddress, "Bottled by Old Tom Distillery, Bardstown, KY");
  assert.equal(label.countryOfOrigin, null);

  const imported = mapReadResultToLabel(
    [...oldTomLines(), line("Product of Scotland", 8)],
    0.98,
  );
  assert.equal(imported.countryOfOrigin, "Product of Scotland");
});

test("azure mapping reassembles a warning split across OCR lines", () => {
  const split = [
    line("OLD TOM DISTILLERY", 40),
    line("GOVERNMENT WARNING: (1) According to the Surgeon General, women"),
    line("should not drink alcoholic beverages during pregnancy because of the"),
    line("risk of birth defects. (2) Consumption of alcoholic beverages impairs"),
    line("your ability to drive a car or operate machinery, and may cause health"),
    line("problems."),
    line("Trailing text that is not part of the warning"),
  ];
  const label = mapReadResultToLabel(split, 0.98);
  assert.equal(label.governmentWarning.present, true);
  assert.equal(label.governmentWarning.text, GOVERNMENT_WARNING);
  // The run stops at "health problems." — trailing artwork text is not swallowed.
  assert.ok(!label.governmentWarning.text!.includes("Trailing text"));
});

test("azure mapping reports the heading's printed capitalisation", () => {
  const caps = mapReadResultToLabel([line(GOVERNMENT_WARNING)], 0.98);
  assert.equal(caps.governmentWarning.headingAllCaps, true);

  const titleCase = mapReadResultToLabel(
    [line(GOVERNMENT_WARNING.replace("GOVERNMENT WARNING:", "Government Warning:"))],
    0.98,
  );
  assert.equal(titleCase.governmentWarning.headingAllCaps, false);
});

test("azure mapping reports a missing warning as absent rather than guessing", () => {
  const label = mapReadResultToLabel([line("OLD TOM DISTILLERY", 40)], 0.98);
  assert.equal(label.governmentWarning.present, false);
  assert.equal(label.governmentWarning.text, null);
  assert.equal(label.governmentWarning.headingAllCaps, null);
});

test("REGRESSION: azure can never report headingBold, so FR-7 routes to REVIEW", () => {
  // Documented capability loss, not a bug. OCR does not carry stroke weight.
  // Asserted so that a future change claiming to fix it has to change this test
  // deliberately rather than by accident.
  for (const lines of [oldTomLines(), [line(GOVERNMENT_WARNING)], []]) {
    assert.equal(mapReadResultToLabel(lines, 0.98).governmentWarning.headingBold, null);
  }
});

test("azure mapping flags unreadable artwork instead of inventing fields", () => {
  const empty = mapReadResultToLabel([], null);
  assert.equal(empty.imageQuality.readable, false);
  assert.ok(empty.imageQuality.issues.length > 0);
  assert.equal(empty.brandName, null);
  assert.equal(empty.classType, null);

  const lowConfidence = mapReadResultToLabel(oldTomLines(), 0.3);
  assert.equal(lowConfidence.imageQuality.readable, false);
  // FR-24: a poor image does not launder a legible defect — the fields it did
  // read are still reported.
  assert.equal(lowConfidence.brandName, "OLD TOM DISTILLERY");
});

test("azure mapping tolerates lines with no geometry", () => {
  const label = mapReadResultToLabel(
    [{ content: "OLD TOM DISTILLERY" }, { content: "750 mL" }],
    null,
  );
  assert.equal(label.netContents, "750 mL");
  assert.equal(label.brandName, "OLD TOM DISTILLERY");
  assert.equal(label.imageQuality.readable, true);
});

test("meanWordConfidence averages across pages and returns null when absent", () => {
  assert.equal(
    meanWordConfidence([{ words: [{ content: "a", confidence: 1 }] }, { words: [{ content: "b", confidence: 0 }] }]),
    0.5,
  );
  assert.equal(meanWordConfidence([{ words: [{ content: "a" }] }]), null);
  assert.equal(meanWordConfidence([]), null);
});
