/**
 * Type-size measurement (FR-10, PRP-24).
 *
 * These tests run the real measurement over the real fixture PNGs rather than
 * over hand-written pixel arrays. That is deliberate. Two earlier attempts at
 * this requirement (docs/TYPE-SIZE-FEASIBILITY.md) were *reproducible while
 * wrong* — stable to three runs, 30-40% off the truth — and the only thing that
 * exposed either was ground truth from outside the instrument. A test that
 * feeds the pipeline a synthetic input it was designed against would reproduce
 * exactly that mistake at a smaller scale.
 *
 * The ground truth here is computable instead of estimated: the fixtures are
 * rendered from HTML at known CSS font sizes, so cap height in pixels follows
 * from geometry. Helvetica's cap height is 0.717em, so a fixture rendered at
 * 23px has a nominal cap of 16.5px, and the measurement is asserted against
 * that number, not against whatever the code currently happens to return.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { measureWarningTypeSize } from "../lib/typesize.ts";
import { requiredTypeSizeMm, verify } from "../lib/compare.ts";
import { GOVERNMENT_WARNING } from "../lib/warning.ts";
import type { ApplicationSubmission, ExtractedLabel } from "../lib/types.ts";

const sample = (name: string) =>
  readFileSync(new URL(`../samples/${name}`, import.meta.url));

/**
 * The width the fixtures are stated to represent. The .label box is 620px wide
 * including its 3px border, so at 100mm one pixel is 0.1613mm and the 2mm
 * threshold for a 750mL bottle lands at a 12.4px cap height.
 */
const STATED_WIDTH_MM = 100;

/** Helvetica cap height as a fraction of em — the fixtures' warning font. */
const HELVETICA_CAP_RATIO = 0.717;

const application: ApplicationSubmission = {
  brandName: "OLD TOM DISTILLERY",
  classType: "Kentucky Straight Bourbon Whiskey",
  alcoholContent: "45% Alc./Vol. (90 Proof)",
  netContents: "750 mL",
};

function label(overrides: Partial<ExtractedLabel> = {}): ExtractedLabel {
  return {
    brandName: "OLD TOM DISTILLERY",
    classType: "Kentucky Straight Bourbon Whiskey",
    alcoholContent: "45% Alc./Vol. (90 Proof)",
    netContents: "750 mL",
    bottlerAddress: null,
    countryOfOrigin: null,
    governmentWarning: {
      present: true,
      text: GOVERNMENT_WARNING,
      headingAllCaps: true,
      headingBold: true,
    },
    imageQuality: { readable: true, issues: [] },
    ...overrides,
  };
}

// --- the regulation's thresholds ------------------------------------------

test("the threshold comes from the container size, per 27 CFR 16.22", () => {
  assert.equal(requiredTypeSizeMm(100).mm, 1);
  assert.equal(requiredTypeSizeMm(237).mm, 1, "237 mL is inside the 1 mm class");
  assert.equal(requiredTypeSizeMm(238).mm, 2);
  assert.equal(requiredTypeSizeMm(750).mm, 2);
  assert.equal(requiredTypeSizeMm(3000).mm, 2, "3 L is inside the 2 mm class");
  assert.equal(requiredTypeSizeMm(3001).mm, 3);
});

// --- measurement against computed ground truth ----------------------------

for (const { file, cssFontPx } of [
  { file: "compliant-warning.png", cssFontPx: 23 },
  { file: "old-tom.png", cssFontPx: 11.5 },
  { file: "tiny-warning.png", cssFontPx: 8 },
]) {
  test(`measures ${file} against its rendered geometry`, async () => {
    const result = await measureWarningTypeSize(sample(file), STATED_WIDTH_MM);
    assert.ok(result.measured, "square-on fixture should be measured");

    // The label is a 620px box; anything else means the boundary detector found
    // the wrong edges, which would silently rescale every millimetre figure.
    assert.equal(result.labelWidthPx, 620);

    const nominalCapPx = cssFontPx * HELVETICA_CAP_RATIO;
    const errorPx = result.capHeightPx - nominalCapPx;

    // Within a pixel of the geometric cap height, and biased upward rather than
    // downward: ink rows include the glyph's antialiasing, so the measurement
    // can only ever round outward from the true edge. Asserting the sign as
    // well as the magnitude is what would catch the detector latching onto an
    // ascender or a descender instead of the cap.
    assert.ok(
      errorPx >= 0 && errorPx <= 1,
      `cap height ${result.capHeightPx}px is ${errorPx.toFixed(2)}px from the nominal ${nominalCapPx.toFixed(2)}px`,
    );

    // The millimetre figure is just the pixel figure times the scale.
    assert.ok(
      Math.abs(result.capHeightMm - (result.capHeightPx * STATED_WIDTH_MM) / 620) < 1e-9,
    );
  });
}

test("a compliant warning is measured clear of the 2 mm minimum", async () => {
  const result = await measureWarningTypeSize(
    sample("compliant-warning.png"),
    STATED_WIDTH_MM,
  );
  assert.ok(result.measured);
  // 17px cap at 0.1613 mm/px = 2.74 mm, against a 2 mm minimum.
  assert.ok(result.capHeightMm > 2.6 && result.capHeightMm < 2.9, `${result.capHeightMm}`);

  // The whole uncertainty interval must sit above the threshold. If the lower
  // bound dipped below 2 mm this fixture would not be evidence that the passing
  // path works — it would be evidence the fixture is too marginal to test with.
  assert.ok(result.capHeightMm - result.uncertaintyMm > 2.0);
});

test("an undersized warning is measured clear below the minimum", async () => {
  const result = await measureWarningTypeSize(sample("tiny-warning.png"), STATED_WIDTH_MM);
  assert.ok(result.measured);
  assert.ok(result.capHeightMm < 1.1, `${result.capHeightMm}`);
  assert.ok(result.capHeightMm + result.uncertaintyMm < 2.0);
});

// --- refusals --------------------------------------------------------------

test("a rotated label is refused, not measured", async () => {
  // The guard fixture. stones-throw-tilted.png is rotated 7 degrees; a rotated
  // rectangle fills only ~0.80 of its axis-aligned bounding box. If this ever
  // returns a measurement the guard is not working, and the module is reporting
  // millimetres off geometry it cannot account for.
  const result = await measureWarningTypeSize(
    sample("stones-throw-tilted.png"),
    STATED_WIDTH_MM,
  );
  assert.equal(result.measured, false);
  assert.equal(result.measured === false && result.reason, "not-square-on");
});

test("no stated width means no measurement, not a guess", async () => {
  const result = await measureWarningTypeSize(sample("old-tom.png"), undefined);
  assert.equal(result.measured, false);
  assert.equal(result.measured === false && result.reason, "no-width-supplied");
});

test("a nonsensical width is refused rather than propagated", async () => {
  for (const width of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = await measureWarningTypeSize(sample("old-tom.png"), width);
    assert.equal(result.measured, false, `width ${width} should not measure`);
  }
});

test("an image with no detectable label is refused", async () => {
  // A uniform field: no boundary, therefore no scale. The failure mode being
  // guarded against is falling back to the image width, which is the arithmetic
  // bug that sank the first attempt (docs/TYPE-SIZE-FEASIBILITY.md, Error 2).
  const { default: sharp } = await import("sharp");
  const flat = await sharp({
    create: { width: 400, height: 400, channels: 3, background: "#808080" },
  })
    .png()
    .toBuffer();

  const result = await measureWarningTypeSize(flat, STATED_WIDTH_MM);
  assert.equal(result.measured, false);
  assert.equal(result.measured === false && result.reason, "label-boundary-not-found");
});

test("measurement is fast enough to sit in the request path", async () => {
  const image = sample("compliant-warning.png");
  await measureWarningTypeSize(image, STATED_WIDTH_MM); // warm sharp
  const started = performance.now();
  await measureWarningTypeSize(image, STATED_WIDTH_MM);
  const elapsed = performance.now() - started;
  // Budget is 300ms (PRP-24). Measured ~7ms; asserting the budget, not the
  // observation, so this does not fail on a loaded CI box.
  assert.ok(elapsed < 300, `type-size measurement took ${elapsed.toFixed(1)}ms`);
});

// --- how the measurement becomes a verdict --------------------------------

test("a compliant type size passes and leaves the overall verdict alone", async () => {
  const measurement = await measureWarningTypeSize(
    sample("compliant-warning.png"),
    STATED_WIDTH_MM,
  );
  const result = verify(application, label(), 1200, measurement);
  assert.equal(result.typeSize?.assessed, true);
  assert.equal(result.typeSize!.assessed && result.typeSize!.verdict, "PASS");
  assert.equal(result.verdict, "PASS");
});

test("an undersized type size fails the application", async () => {
  const measurement = await measureWarningTypeSize(
    sample("tiny-warning.png"),
    STATED_WIDTH_MM,
  );
  const result = verify(application, label(), 1200, measurement);
  assert.equal(result.typeSize!.assessed && result.typeSize!.verdict, "FAIL");
  assert.equal(result.verdict, "FAIL", "a warning below the minimum is a real defect");
  assert.match(result.typeSize!.reason, /1\.0 mm/);
  assert.match(result.typeSize!.reason, /2 mm minimum/);
});

test("a refusal is reported as not assessed and changes no verdict", async () => {
  // The load-bearing property of the whole feature. An otherwise-clean label
  // whose type size could not be measured must come back exactly as clean as it
  // would have without the check — not nudged to REVIEW for being unmeasurable,
  // and certainly not to FAIL.
  const withoutCheck = verify(application, label(), 1200);
  const refused = await measureWarningTypeSize(
    sample("stones-throw-tilted.png"),
    STATED_WIDTH_MM,
  );
  const withRefusal = verify(application, label(), 1200, refused);

  assert.equal(withRefusal.typeSize?.assessed, false);
  assert.equal(withRefusal.verdict, withoutCheck.verdict);
  assert.equal(withRefusal.verdict, "PASS");
});

test("absent width reports not assessed rather than omitting the row", async () => {
  // "Not assessed" has to be visible. Silently dropping the check would let an
  // agent read a clean result as "the type size was checked and was fine".
  const measurement = await measureWarningTypeSize(sample("old-tom.png"), undefined);
  const result = verify(application, label(), 1200, measurement);
  assert.equal(result.typeSize?.assessed, false);
  assert.match(result.typeSize!.reason, /No physical label width/);
  assert.equal(result.verdict, "PASS");
});

test("a refusal does not rescue a label that fails for other reasons", async () => {
  const refused = await measureWarningTypeSize(sample("stones-throw-tilted.png"), undefined);
  const result = verify(application, label({ brandName: "SOMETHING ELSE" }), 1200, refused);
  assert.equal(result.verdict, "FAIL");
});

test("an unparseable net contents means the threshold is unknown, so no claim", async () => {
  // The minimum is a function of container size. Measuring 2.7mm tells us
  // nothing if we cannot say whether 1, 2 or 3 mm was required.
  const measurement = await measureWarningTypeSize(
    sample("compliant-warning.png"),
    STATED_WIDTH_MM,
  );
  const result = verify(
    { ...application, netContents: "one bottle" },
    label(),
    1200,
    measurement,
  );
  assert.equal(result.typeSize?.assessed, false);
  assert.match(result.typeSize!.reason, /container size/);
});

test("omitting the measurement entirely leaves the result shape unchanged", () => {
  // Every pre-existing call site passes three arguments. They must keep working
  // and must not sprout an empty type-size row.
  const result = verify(application, label(), 1200);
  assert.equal(result.typeSize, undefined);
  assert.equal(result.verdict, "PASS");
});

test("a measured undersized warning survives the unreadable-image softening", async () => {
  // verify() downgrades FAIL to REVIEW when a photo was too poor to read and
  // the only failures were absent fields. A type size that was actually
  // measured is not an absent field: the geometry resolved well enough to
  // measure, and typesize.ts would have refused if it had not.
  const measurement = await measureWarningTypeSize(
    sample("tiny-warning.png"),
    STATED_WIDTH_MM,
  );
  const result = verify(
    application,
    label({
      brandName: null,
      imageQuality: { readable: false, issues: ["glare"] },
    }),
    1200,
    measurement,
  );
  assert.equal(result.verdict, "FAIL");
});

/**
 * Anisotropic distortion — the gap adversarial review found in the first build.
 *
 * Rectangularity is scale-invariant, so a stretched image stays a perfect
 * rectangle and sails through the not-square-on gate while every vertical
 * reading taken from it is inflated. Scale is derived from the width, so a
 * vertical stretch biases the result UPWARD: it makes an undersized warning
 * look compliant. That is the one direction this tool must never fail in, and
 * it is the opposite of the direction the REVIEW band is tuned to protect.
 */
test("a vertically stretched label is refused when a height is supplied", async () => {
  const sharp = (await import("sharp")).default;
  // 620x840 label in an 800x1000 frame; stretch the frame's height by 1.67x.
  const stretched = await sharp(sample("compliant-warning.png"))
    .resize(800, 1667, { fit: "fill" })
    .png()
    .toBuffer();

  const result = await measureWarningTypeSize(stretched, 100, 135);
  assert.equal(result.measured, false);
  assert.equal(result.measured === false && result.reason, "aspect-distorted");
});

test("an undistorted label passes the aspect check", async () => {
  // The label box is 620x840, so a 100mm width implies ~135mm of height.
  const result = await measureWarningTypeSize(
    sample("compliant-warning.png"),
    100,
    135,
  );
  assert.equal(result.measured, true);
});

test("without a stated height, aspect distortion is undetectable — a known limit", async () => {
  const sharp = (await import("sharp")).default;
  const stretched = await sharp(sample("compliant-warning.png"))
    .resize(800, 1667, { fit: "fill" })
    .png()
    .toBuffer();

  // Documents real behaviour rather than asserting a guarantee we do not have:
  // with width alone there is nothing to compare the detected aspect against,
  // so the stretched image IS measured, and measured wrongly. This is why the
  // limitation is disclosed in the README instead of being papered over.
  const result = await measureWarningTypeSize(stretched, 100);
  assert.equal(result.measured, true);
});

test("a cap height too small to measure honestly is refused", async () => {
  const sharp = (await import("sharp")).default;
  // Shrink until the warning's cap falls below the 8px floor. Quantisation is
  // a fixed +-1px, so below that it exceeds 12.5% of the reading and would eat
  // the REVIEW band the verdict depends on.
  const shrunk = await sharp(sample("tiny-warning.png"))
    .resize({ width: 400 })
    .png()
    .toBuffer();

  const result = await measureWarningTypeSize(shrunk, 100);
  assert.equal(result.measured, false);
});
