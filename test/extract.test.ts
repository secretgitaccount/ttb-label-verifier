import assert from "node:assert/strict";
import { test } from "node:test";
import { validateExtractedLabel } from "../lib/extract.ts";
import { GOVERNMENT_WARNING } from "../lib/warning.ts";

/** A well-formed model response, as structured outputs should produce it. */
function payload(): Record<string, unknown> {
  return {
    brandName: "OLD TOM DISTILLERY",
    classType: "Kentucky Straight Bourbon Whiskey",
    alcoholContent: "45% Alc./Vol. (90 Proof)",
    netContents: "750 mL",
    bottlerAddress: "Bottled by Old Tom Distillery, Bardstown, KY",
    countryOfOrigin: null,
    governmentWarning: {
      present: true,
      text: GOVERNMENT_WARNING,
      headingAllCaps: true,
      headingBold: true,
    },
    imageQuality: { readable: true, issues: [] },
  };
}

/** Same payload with one branch replaced, so each test states only its defect. */
function withWarning(overrides: Record<string, unknown>) {
  const base = payload();
  return { ...base, governmentWarning: { ...(base.governmentWarning as object), ...overrides } };
}

function withQuality(overrides: Record<string, unknown>) {
  const base = payload();
  return { ...base, imageQuality: { ...(base.imageQuality as object), ...overrides } };
}

test("a valid payload passes through unchanged", () => {
  const result = validateExtractedLabel(payload());
  assert.deepEqual(result, payload());
});

test("nulls are preserved rather than rejected", () => {
  const result = validateExtractedLabel({
    ...payload(),
    brandName: null,
    classType: null,
    ...{ governmentWarning: { present: false, text: null, headingAllCaps: null, headingBold: null } },
  });
  assert.equal(result.brandName, null);
  assert.equal(result.governmentWarning.present, false);
  assert.equal(result.governmentWarning.text, null);
});

test("the optional label statements survive transcription", () => {
  const result = validateExtractedLabel({
    ...payload(),
    countryOfOrigin: "Product of Scotland",
  });
  assert.equal(result.bottlerAddress, "Bottled by Old Tom Distillery, Bardstown, KY");
  assert.equal(result.countryOfOrigin, "Product of Scotland");
});

test("absent optional statements read as null rather than as an error", () => {
  const { bottlerAddress, countryOfOrigin, ...rest } = payload();
  void bottlerAddress;
  void countryOfOrigin;
  const result = validateExtractedLabel(rest);
  assert.equal(result.bottlerAddress, null);
  assert.equal(result.countryOfOrigin, null);
});

test("an optional statement of the wrong type is still rejected", () => {
  assert.throws(
    () => validateExtractedLabel({ ...payload(), countryOfOrigin: 42 }),
    /countryOfOrigin should be text/,
  );
});

test("an absent headingBold reads as uncertain, not as an error", () => {
  const warning = { present: true, text: GOVERNMENT_WARNING, headingAllCaps: true };
  const result = validateExtractedLabel({ ...payload(), governmentWarning: warning });
  assert.equal(result.governmentWarning.headingBold, null);
});

test("a non-object response is rejected", () => {
  assert.throws(() => validateExtractedLabel("not json at all"), /not an object/);
  assert.throws(() => validateExtractedLabel(null), /not an object/);
  assert.throws(() => validateExtractedLabel([payload()]), /not an object/);
});

test("a missing top-level field names the field", () => {
  const { brandName, ...rest } = payload();
  void brandName;
  assert.throws(() => validateExtractedLabel(rest), /brandName is missing/);
});

test("a top-level field of the wrong type is rejected", () => {
  assert.throws(
    () => validateExtractedLabel({ ...payload(), netContents: 750 }),
    /netContents should be text/,
  );
});

test("a missing governmentWarning is rejected", () => {
  const { governmentWarning, ...rest } = payload();
  void governmentWarning;
  assert.throws(() => validateExtractedLabel(rest), /governmentWarning is missing/);
});

test("governmentWarning.present must be a boolean", () => {
  assert.throws(
    () => validateExtractedLabel(withWarning({ present: "yes" })),
    /governmentWarning\.present should be true or false/,
  );
  const warning = withWarning({});
  delete (warning.governmentWarning as Record<string, unknown>).present;
  assert.throws(() => validateExtractedLabel(warning), /governmentWarning\.present is missing/);
});

test("a nested field of the wrong type is rejected", () => {
  assert.throws(
    () => validateExtractedLabel(withWarning({ headingBold: "bold" })),
    /governmentWarning\.headingBold should be true or false/,
  );
  assert.throws(
    () => validateExtractedLabel(withWarning({ text: 42 })),
    /text should be text/,
  );
});

test("a missing or malformed imageQuality is rejected", () => {
  const { imageQuality, ...rest } = payload();
  void imageQuality;
  assert.throws(() => validateExtractedLabel(rest), /imageQuality is missing/);
  assert.throws(
    () => validateExtractedLabel({ ...payload(), imageQuality: "fine" }),
    /imageQuality was not an object/,
  );
  assert.throws(
    () => validateExtractedLabel(withQuality({ readable: 1 })),
    /imageQuality\.readable should be true or false/,
  );
  assert.throws(
    () => validateExtractedLabel(withQuality({ issues: "glare" })),
    /imageQuality\.issues was not a list/,
  );
  assert.throws(
    () => validateExtractedLabel(withQuality({ issues: ["glare", 7] })),
    /non-text entry/,
  );
});

test("every rejection message is plain English fit for the screen", () => {
  // describeFailure in route.ts shows our Error messages verbatim, so they must
  // read as sentences rather than as type assertions.
  let caught: unknown;
  try {
    validateExtractedLabel({ ...payload(), classType: false });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof Error);
  assert.match(
    caught.message,
    /^The label was read but the response was not in the expected format \(.+\)\. Try again\.$/,
  );
});
