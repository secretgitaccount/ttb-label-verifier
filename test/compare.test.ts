import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { verify, parseAbv, parseVolumeMl, normalize } from "../lib/compare.ts";
import { checkWarningText, GOVERNMENT_WARNING } from "../lib/warning.ts";
import { parseManifest } from "../lib/csv.ts";
import type { ApplicationRecord, ExtractedLabel } from "../lib/types.ts";

const application: ApplicationRecord = {
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

const field = (result: ReturnType<typeof verify>, key: string) =>
  result.fields.find((f) => f.field === key)!;

test("a fully compliant label passes", () => {
  const result = verify(application, label(), 1200);
  assert.equal(result.verdict, "PASS");
});

test("case and punctuation differences are not defects", () => {
  const result = verify(
    { ...application, brandName: "Stone's Throw" },
    label({ brandName: "STONE'S THROW" }),
    0,
  );
  assert.equal(field(result, "brandName").verdict, "PASS");
});

test("a genuinely different brand name fails", () => {
  const result = verify(application, label({ brandName: "YOUNG TOM DISTILLERY" }), 0);
  assert.equal(field(result, "brandName").verdict, "FAIL");
  assert.equal(result.verdict, "FAIL");
});

test("a near-miss brand name is flagged for a human", () => {
  const result = verify(application, label({ brandName: "OLD TOM DISTILLERIES" }), 0);
  assert.equal(field(result, "brandName").verdict, "REVIEW");
});

test("title-case government warning is rejected", () => {
  const titleCase = GOVERNMENT_WARNING.replace(
    "GOVERNMENT WARNING:",
    "Government Warning:",
  );
  const result = verify(
    application,
    label({
      governmentWarning: {
        present: true,
        text: titleCase,
        headingAllCaps: false,
        headingBold: true,
      },
    }),
    0,
  );
  assert.equal(field(result, "governmentWarning").verdict, "FAIL");
  assert.match(field(result, "governmentWarning").reason, /capital letters/);
});

test("altered warning wording is rejected and located", () => {
  const altered = GOVERNMENT_WARNING.replace("should not drink", "may wish to avoid");
  const result = verify(
    application,
    label({
      governmentWarning: {
        present: true,
        text: altered,
        headingAllCaps: true,
        headingBold: true,
      },
    }),
    0,
  );
  const warning = field(result, "governmentWarning");
  assert.equal(warning.verdict, "FAIL");
  assert.match(warning.reason, /may/);
});

test("line breaks in the warning artwork are tolerated", () => {
  const wrapped = GOVERNMENT_WARNING.replace(/ /g, "\n   ");
  assert.equal(checkWarningText(wrapped).textExact, true);
});

test("a missing warning fails", () => {
  const result = verify(
    application,
    label({
      governmentWarning: {
        present: false,
        text: null,
        headingAllCaps: null,
        headingBold: null,
      },
    }),
    0,
  );
  assert.equal(field(result, "governmentWarning").verdict, "FAIL");
});

test("a correctly capitalised but unbolded warning heading fails", () => {
  const result = verify(
    application,
    label({
      governmentWarning: {
        present: true,
        text: GOVERNMENT_WARNING,
        headingAllCaps: true,
        headingBold: false,
      },
    }),
    0,
  );
  const warning = field(result, "governmentWarning");
  assert.equal(warning.verdict, "FAIL");
  assert.match(warning.reason, /bold/);
  assert.equal(result.verdict, "FAIL");
});

test("an uncertain bold reading is a review, never an approval", () => {
  const result = verify(
    application,
    label({
      governmentWarning: {
        present: true,
        text: GOVERNMENT_WARNING,
        headingAllCaps: true,
        headingBold: null,
      },
    }),
    0,
  );
  const warning = field(result, "governmentWarning");
  assert.equal(warning.verdict, "REVIEW");
  assert.match(warning.reason, /bold/);
  assert.equal(result.verdict, "REVIEW");
});

test("a wording defect outranks an uncertain bold reading", () => {
  const result = verify(
    application,
    label({
      governmentWarning: {
        present: true,
        text: GOVERNMENT_WARNING.replace("birth defects", "birth problems"),
        headingAllCaps: true,
        headingBold: null,
      },
    }),
    0,
  );
  assert.equal(field(result, "governmentWarning").verdict, "FAIL");
});

test("a label with altered wording AND a light heading names both defects", () => {
  const result = verify(
    application,
    label({
      governmentWarning: {
        present: true,
        text: GOVERNMENT_WARNING.replace("should not drink", "may wish to avoid"),
        headingAllCaps: true,
        headingBold: false,
      },
    }),
    0,
  );
  const warning = field(result, "governmentWarning");
  assert.equal(warning.verdict, "FAIL");
  assert.match(warning.reason, /reads "may"/); // the wording defect
  assert.match(warning.reason, /bold/); // the weight defect
  assert.equal(result.verdict, "FAIL");
});

test("a title-case heading in light type names both defects", () => {
  const result = verify(
    application,
    label({
      governmentWarning: {
        present: true,
        text: GOVERNMENT_WARNING.replace("GOVERNMENT WARNING:", "Government Warning:"),
        headingAllCaps: false,
        headingBold: false,
      },
    }),
    0,
  );
  const warning = field(result, "governmentWarning");
  assert.equal(warning.verdict, "FAIL");
  assert.match(warning.reason, /capital letters/);
  assert.match(warning.reason, /bold/);
});

test("a pure capitalisation defect is reported once, not twice", () => {
  const result = verify(
    application,
    label({
      governmentWarning: {
        present: true,
        text: GOVERNMENT_WARNING.replace("GOVERNMENT WARNING:", "Government Warning:"),
        headingAllCaps: false,
        headingBold: true,
      },
    }),
    0,
  );
  const reason = field(result, "governmentWarning").reason;
  assert.equal(reason.match(/capital/gi)?.length, 1);
});

test("wording defects are reported ahead of weight defects", () => {
  const result = verify(
    application,
    label({
      governmentWarning: {
        present: true,
        text: GOVERNMENT_WARNING.replace("birth defects", "birth problems"),
        headingAllCaps: true,
        headingBold: false,
      },
    }),
    0,
  );
  const reason = field(result, "governmentWarning").reason;
  assert.ok(reason.indexOf("problems") < reason.indexOf("bold"));
});

test("an uncertain bold reading alongside a wording defect stays a FAIL", () => {
  const result = verify(
    application,
    label({
      governmentWarning: {
        present: true,
        text: GOVERNMENT_WARNING.replace("birth defects", "birth problems"),
        headingAllCaps: true,
        headingBold: null,
      },
    }),
    0,
  );
  const warning = field(result, "governmentWarning");
  assert.equal(warning.verdict, "FAIL");
  assert.match(warning.reason, /problems/);
});






test("net contents match across units", () => {
  const result = verify(
    { ...application, netContents: "0.75 L" },
    label({ netContents: "750 mL" }),
    0,
  );
  assert.equal(field(result, "netContents").verdict, "PASS");
});

test("wrong net contents fails", () => {
  const result = verify(application, label({ netContents: "700 mL" }), 0);
  assert.equal(field(result, "netContents").verdict, "FAIL");
});

test("proof inconsistent with ABV fails even when the application agrees", () => {
  const result = verify(
    application,
    label({ alcoholContent: "45% Alc./Vol. (80 Proof)" }),
    0,
  );
  assert.equal(field(result, "alcoholContent").verdict, "FAIL");
  assert.match(field(result, "alcoholContent").reason, /inconsistent/);
});

test("ABV inside the labelling tolerance is a review, not a failure", () => {
  const result = verify(
    application,
    label({ alcoholContent: "45.1% Alc./Vol." }),
    0,
  );
  assert.equal(field(result, "alcoholContent").verdict, "REVIEW");
});

test("ABV outside the tolerance fails", () => {
  const result = verify(application, label({ alcoholContent: "40% Alc./Vol." }), 0);
  assert.equal(field(result, "alcoholContent").verdict, "FAIL");
});

test("an unreadable photo asks for a better image instead of failing", () => {
  const result = verify(
    application,
    label({
      brandName: null,
      classType: null,
      imageQuality: { readable: false, issues: ["heavy glare"] },
    }),
    0,
  );
  assert.equal(result.verdict, "REVIEW");
});

test("an unreadable photo still fails on a warning defect it could read", () => {
  const result = verify(
    application,
    label({
      governmentWarning: {
        present: true,
        text: GOVERNMENT_WARNING.replace("GOVERNMENT WARNING:", "Government Warning:"),
        headingAllCaps: false,
        headingBold: true,
      },
      imageQuality: { readable: false, issues: ["blurry"] },
    }),
    0,
  );
  assert.equal(result.verdict, "FAIL");
});

// --- Optional elements: bottler address and country of origin (FR-8, FR-9) ---

test("a domestic application asserting neither optional field is still checked", () => {
  const result = verify(application, label(), 1200);
  assert.equal(result.verdict, "PASS");
  // Nothing is inferred from silence: the fields must not even be reported.
  assert.equal(result.fields.length, 5);
  assert.equal(
    result.fields.some((f) => f.field === "bottlerAddress" || f.field === "countryOfOrigin"),
    false,
  );
});

test("a label carrying neither statement is not a defect when nobody claimed one", () => {
  const result = verify(
    application,
    label({ bottlerAddress: null, countryOfOrigin: null }),
    1200,
  );
  assert.equal(result.verdict, "PASS");
});

test("matching optional statements pass", () => {
  const result = verify(
    {
      ...application,
      bottlerAddress: "Bottled by Old Tom Distillery, Bardstown, KY",
      countryOfOrigin: "Product of Scotland",
    },
    label({
      bottlerAddress: "Bottled by Old Tom Distillery, Bardstown, KY",
      countryOfOrigin: "Product of Scotland",
    }),
    1200,
  );
  assert.equal(result.verdict, "PASS");
  assert.equal(field(result, "bottlerAddress").verdict, "PASS");
  assert.equal(field(result, "countryOfOrigin").verdict, "PASS");
});

test("an optional statement absent from the artwork is a review, never a failure", () => {
  // "Not on the product" and "not in this photograph" are indistinguishable
  // from one image, so this is exactly the judgement an agent must make.
  const result = verify(
    { ...application, countryOfOrigin: "Product of Scotland" },
    label({ countryOfOrigin: null }),
    1200,
  );
  assert.equal(result.verdict, "REVIEW");
  assert.equal(field(result, "countryOfOrigin").verdict, "REVIEW");
});

test("an optional statement that contradicts the application fails", () => {
  const result = verify(
    { ...application, countryOfOrigin: "Product of Scotland" },
    label({ countryOfOrigin: "Product of Canada" }),
    1200,
  );
  assert.equal(result.verdict, "FAIL");
  assert.equal(field(result, "countryOfOrigin").verdict, "FAIL");
});

test("optional fields tolerate styling variance like every other text field", () => {
  const result = verify(
    { ...application, countryOfOrigin: "Product of Scotland" },
    label({ countryOfOrigin: "PRODUCT OF SCOTLAND" }),
    1200,
  );
  assert.equal(field(result, "countryOfOrigin").verdict, "PASS");
});

test("a blank optional value asserts nothing", () => {
  const result = verify(
    { ...application, bottlerAddress: "   ", countryOfOrigin: "" },
    label({ bottlerAddress: null, countryOfOrigin: null }),
    1200,
  );
  assert.equal(result.verdict, "PASS");
  assert.equal(result.fields.length, 5);
});

test("parsers handle the common label formats", () => {
  assert.equal(parseAbv("45% Alc./Vol. (90 Proof)"), 45);
  assert.equal(parseAbv("90 Proof"), 45);
  assert.equal(parseVolumeMl("1.75 L"), 1750);
  assert.equal(parseVolumeMl("50 cl"), 500);
  assert.equal(normalize("Stone's  Throw!"), "STONE S THROW");
});

test("CSV manifests accept quoted commas and header aliases", () => {
  const { records, errors } = parseManifest(
    'file_name,brand,type,abv,volume\n"a.jpg","Smith, Sons & Co","Blended Whisky","40%","750 mL"',
  );
  assert.deepEqual(errors, []);
  assert.equal(records.length, 1);
  assert.equal(records[0].brandName, "Smith, Sons & Co");
  assert.equal(records[0].classType, "Blended Whisky");
});

test("CSV manifests report missing columns rather than guessing", () => {
  const { records, errors } = parseManifest("file_name,brand_name\na.jpg,ACME");
  assert.equal(records.length, 0);
  assert.match(errors[0], /missing these columns/);
});

test("a manifest without the optional columns still parses", () => {
  // Importers already hold manifests in the original five-column shape, and
  // making the new columns required would break every one of them. Asserted
  // against an inline manifest rather than the shipped file, so that adding a
  // fixture cannot make this back-compat guarantee silently stop being tested.
  const { records, errors } = parseManifest(
    "file_name,brand_name,class_type,alcohol_content,net_contents\n" +
      "a.png,ACME,Bourbon Whiskey,45% Alc./Vol.,750 mL\n",
  );
  assert.deepEqual(errors, []);
  assert.equal(records.length, 1);
  assert.equal(records[0].bottlerAddress, undefined);
  assert.equal(records[0].countryOfOrigin, undefined);
});

test("the shipped manifest parses and every row names a real fixture", () => {
  // The manifest is demo data a reviewer will actually run. An earlier version
  // referenced .jpg files that were never generated, so batch mode failed on
  // the shipped sample set. This asserts the two stay in step.
  const csv = readFileSync(
    new URL("../samples/manifest.csv", import.meta.url),
    "utf8",
  );
  const { records, errors } = parseManifest(csv);
  assert.deepEqual(errors, []);
  assert.ok(records.length > 0, "shipped manifest should not be empty");

  for (const record of records) {
    const fixture = new URL(`../samples/${record.fileName}`, import.meta.url);
    assert.ok(
      existsSync(fixture),
      `manifest names ${record.fileName}, which is not in samples/`,
    );
  }
});

test("CSV manifests accept the optional columns when supplied", () => {
  const { records, errors } = parseManifest(
    "file_name,brand_name,class_type,alcohol_content,net_contents,bottler_address,country_of_origin\n" +
      'scotch.png,GLEN CAIRNGORM,Single Malt Scotch Whisky,43% Alc./Vol.,750 mL,"Cairngorm Imports Ltd., Portland, OR",Product of Scotland',
  );
  assert.deepEqual(errors, []);
  assert.equal(records[0].bottlerAddress, "Cairngorm Imports Ltd., Portland, OR");
  assert.equal(records[0].countryOfOrigin, "Product of Scotland");
});

test("CSV manifests accept an optional label width column", () => {
  const { records, errors } = parseManifest(
    "file_name,brand_name,class_type,alcohol_content,net_contents,label_width_mm\n" +
      "a.png,ACME,Bourbon,45% Alc./Vol.,750 mL,100",
  );
  assert.deepEqual(errors, []);
  assert.equal(records[0].labelWidthMm, "100");
});

test("a manifest with no label width column still parses", () => {
  // Every manifest an importer already holds predates this column. Adding it to
  // the required set would reject all of them, so it has to stay optional in
  // exactly the way bottler_address and country_of_origin are — absent means
  // the type-size check reports "not assessed", never that the row is invalid.
  const { records, errors } = parseManifest(
    "file_name,brand_name,class_type,alcohol_content,net_contents\n" +
      "a.png,ACME,Bourbon,45% Alc./Vol.,750 mL",
  );
  assert.deepEqual(errors, []);
  assert.equal(records[0].labelWidthMm, undefined);
});

test("a blank optional cell is left unset rather than asserted as empty", () => {
  const { records, errors } = parseManifest(
    "file_name,brand_name,class_type,alcohol_content,net_contents,country_of_origin\n" +
      "a.png,ACME,Bourbon,45% Alc./Vol.,750 mL,",
  );
  assert.deepEqual(errors, []);
  assert.equal(records.length, 1);
  assert.equal(records[0].countryOfOrigin, undefined);
});
