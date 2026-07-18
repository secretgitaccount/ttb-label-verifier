#!/usr/bin/env node
/**
 * Renders test label artwork with headless Chrome.
 *
 * These are synthetic stand-ins for real COLA submissions — good enough to
 * exercise the pipeline end to end, including labels with deliberate defects,
 * without needing to source real artwork.
 *
 * Usage: node scripts/make-samples.mjs
 */

import { execFile } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";

const run = promisify(execFile);

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT_DIR = new URL("../samples/", import.meta.url).pathname;
const TMP_DIR = "/tmp/label-samples";

const WARNING =
  "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not " +
  "drink alcoholic beverages during pregnancy because of the risk of birth " +
  "defects. (2) Consumption of alcoholic beverages impairs your ability to " +
  "drive a car or operate machinery, and may cause health problems.";

function labelHtml({
  brand,
  classType,
  abv,
  net,
  warning,
  tilt = 0,
  origin = "",
  bottler = "",
  // Warning type size in CSS px. The default 11.5 is what every pre-existing
  // fixture renders at — leaving it alone keeps those PNGs byte-identical.
  // See the type-size fixtures below for how non-default values are derived.
  warningFontSize = 11.5,
}) {
  return `<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 800px; height: 1000px; background: #2b2b2b;
    display: grid; place-items: center; font-family: Georgia, serif; }
  .label { width: 620px; height: 840px; background: #f3ead6; color: #1a1208;
    border: 3px solid #8a6a2f; padding: 40px 34px; box-sizing: border-box;
    display: flex; flex-direction: column; text-align: center;
    transform: rotate(${tilt}deg); }
  .rule { border-top: 2px solid #8a6a2f; margin: 18px 0; }
  .brand { font-size: 46px; font-weight: bold; letter-spacing: 2px; line-height: 1.1; }
  .class { font-size: 25px; font-style: italic; margin-top: 14px; }
  .spacer { flex: 1; }
  .abv { font-size: 27px; letter-spacing: 1px; }
  .net { font-size: 23px; margin-top: 8px; }
  .origin { font-size: 21px; letter-spacing: 1px; margin-top: 12px;
    text-transform: uppercase; }
  .bottler { font-size: 15px; line-height: 1.4; margin-top: 12px; }
  .warning { font-size: ${warningFontSize}px; text-align: left; line-height: 1.45;
    margin-top: 26px; font-family: Helvetica, Arial, sans-serif; }
  .warning b { font-weight: 700; }
  /* Isolates weight from capitalisation: the heading stays ALL CAPS but is
     set at the same weight as the body sentences that follow it. */
  .warning .plain-heading { font-weight: 400; }
</style>
<div class="label">
  <div style="font-size:15px; letter-spacing:4px;">EST. 1897</div>
  <div class="rule"></div>
  <div class="brand">${brand}</div>
  <div class="class">${classType}</div>
  <div class="spacer"></div>
  <div class="abv">${abv}</div>
  <div class="net">${net}</div>
  ${origin ? `<div class="origin">${origin}</div>` : ""}
  ${bottler ? `<div class="bottler">${bottler}</div>` : ""}
  <div class="rule"></div>
  <div class="warning">${warning}</div>
</div>`;
}

const SAMPLES = [
  {
    name: "old-tom",
    note: "fully compliant",
    html: labelHtml({
      brand: "OLD TOM DISTILLERY",
      classType: "Kentucky Straight Bourbon Whiskey",
      abv: "45% Alc./Vol. (90 Proof)",
      net: "750 mL",
      warning: WARNING.replace("GOVERNMENT WARNING:", "<b>GOVERNMENT WARNING:</b>"),
    }),
  },
  {
    name: "title-case-warning",
    note: "warning heading in title case — must be rejected",
    html: labelHtml({
      brand: "OLD TOM DISTILLERY",
      classType: "Kentucky Straight Bourbon Whiskey",
      abv: "45% Alc./Vol. (90 Proof)",
      net: "750 mL",
      warning: WARNING.replace("GOVERNMENT WARNING:", "<b>Government Warning:</b>"),
    }),
  },
  {
    name: "unbolded-warning",
    note: "warning heading is ALL CAPS but regular weight — must be rejected",
    html: labelHtml({
      brand: "OLD TOM DISTILLERY",
      classType: "Kentucky Straight Bourbon Whiskey",
      abv: "45% Alc./Vol. (90 Proof)",
      net: "750 mL",
      warning: WARNING.replace(
        "GOVERNMENT WARNING:",
        '<span class="plain-heading">GOVERNMENT WARNING:</span>',
      ),
    }),
  },
  {
    name: "wrong-abv",
    note: "label says 40%, application says 45% — must be rejected",
    html: labelHtml({
      brand: "OLD TOM DISTILLERY",
      classType: "Kentucky Straight Bourbon Whiskey",
      abv: "40% Alc./Vol. (80 Proof)",
      net: "750 mL",
      warning: WARNING.replace("GOVERNMENT WARNING:", "<b>GOVERNMENT WARNING:</b>"),
    }),
  },
  {
    name: "stones-throw-tilted",
    note: "case variance + photographed at an angle — should still pass",
    html: labelHtml({
      brand: "STONE'S THROW",
      classType: "Straight Rye Whiskey",
      abv: "50% Alc./Vol. (100 Proof)",
      net: "0.75 L",
      warning: WARNING.replace("GOVERNMENT WARNING:", "<b>GOVERNMENT WARNING:</b>"),
      tilt: -7,
    }),
  },
  {
    name: "imported-scotch",
    note: "carries a country of origin AND a bottler address — exercises the optional fields",
    html: labelHtml({
      brand: "GLEN CAIRNGORM",
      classType: "Single Malt Scotch Whisky",
      abv: "43% Alc./Vol. (86 Proof)",
      net: "750 mL",
      origin: "Product of Scotland",
      bottler:
        "Imported and bottled by Cairngorm Imports Ltd., Portland, OR",
      warning: WARNING.replace("GOVERNMENT WARNING:", "<b>GOVERNMENT WARNING:</b>"),
    }),
  },

  // ---------------------------------------------------------------------
  // Type-size fixtures (FR-10 / PRP-24).
  //
  // Both are 750 mL, so 27 CFR 16.22 sets a 2 mm minimum. Both are flat and
  // square-on (tilt 0) so they are inside the measurable scope. They are
  // identical to `old-tom` in every respect except warning type size.
  //
  // Geometry. The .label box is 620 px wide with a 3 px border, so the printed
  // cream field a boundary detector actually finds is 620 - 2*3 = 614 px.
  // Stating a 100 mm physical label width:
  //
  //     mm-per-px = 100 / 614 = 0.16287        (0.16129 if you scale on 620)
  //     2 mm threshold        = 12.28 px cap height
  //
  // Font size. Helvetica's cap height is 0.717 em, so a target cap height C px
  // needs font-size = C / 0.717. Rasterisation then adds up to ~1 px of ink
  // rows on top of the geometric cap, so the CSS value is chosen a little
  // under target and the RESULT IS MEASURED, never assumed:
  //
  //   compliant-warning  target ~2.8 mm -> 2.8 / 0.16287 = 17.2 px cap
  //                      -> font-size 17.2 / 0.717 ~= 24 px, backed off to 23
  //                      -> measured 17 px  =  2.77 mm  (1.39x threshold)
  //
  //   tiny-warning       target ~1.0 mm -> 1.0 / 0.16287 =  6.1 px cap
  //                      -> font-size  6.1 / 0.717 ~= 8.5 px, backed off to 8
  //                      -> measured  6 px  =  0.98 mm  (0.49x threshold)
  //
  // For contrast, `old-tom` at the default 11.5 px measures a 9 px cap =
  // 1.47 mm, which is under the 2 mm minimum — hence the need for these two.
  //
  // Measured values above come from decoding the emitted PNGs: threshold to
  // ink, find the row bands below the last full-width rule, take the leftmost
  // column run of the first warning line (the capital "G" of GOVERNMENT, which
  // has neither ascender nor descender) and take its vertical ink extent.
  // ---------------------------------------------------------------------
  {
    name: "compliant-warning",
    note: "750 mL with a 23px warning — measured 17px cap = 2.77mm, comfortably over the 2mm minimum",
    html: labelHtml({
      brand: "OLD TOM DISTILLERY",
      classType: "Kentucky Straight Bourbon Whiskey",
      abv: "45% Alc./Vol. (90 Proof)",
      net: "750 mL",
      warning: WARNING.replace("GOVERNMENT WARNING:", "<b>GOVERNMENT WARNING:</b>"),
      warningFontSize: 23,
    }),
  },
  {
    name: "tiny-warning",
    note: "750 mL with an 8px warning — measured 6px cap = 0.98mm, half the 2mm minimum",
    html: labelHtml({
      brand: "OLD TOM DISTILLERY",
      classType: "Kentucky Straight Bourbon Whiskey",
      abv: "45% Alc./Vol. (90 Proof)",
      net: "750 mL",
      warning: WARNING.replace("GOVERNMENT WARNING:", "<b>GOVERNMENT WARNING:</b>"),
      warningFontSize: 8,
    }),
  },
];

await mkdir(TMP_DIR, { recursive: true });
await mkdir(OUT_DIR, { recursive: true });

for (const sample of SAMPLES) {
  const htmlPath = join(TMP_DIR, `${sample.name}.html`);
  await writeFile(htmlPath, sample.html);

  // Chrome writes the screenshot to CWD, so render from the output directory.
  await run(
    CHROME,
    [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      "--window-size=800,1000",
      `--screenshot=${join(OUT_DIR, `${sample.name}.png`)}`,
      `file://${htmlPath}`,
    ],
    { timeout: 30000 },
  );

  console.log(`✓ samples/${sample.name}.png — ${sample.note}`);
}

await rm(TMP_DIR, { recursive: true, force: true });
console.log("\nDone. Run the smoke test against any of these.");
