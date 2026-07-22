/**
 * Ground truth for the transcription eval.
 *
 * `expected` is what the model *should* read off each fixture, verbatim — the
 * oracle the model's output is scored against. It is derived from the fixture
 * definitions in scripts/make-samples.mjs, not from what the model happens to
 * return, so the eval measures the model rather than agreeing with it.
 *
 * `expectedVerdict` is the overall compliance verdict attributable to the
 * transcription — i.e. verify() run on a correct reading, WITHOUT type size.
 * Type size is a deterministic pixel measurement (lib/typesize.ts) with its own
 * unit coverage; it is not a model output, so it is out of scope for a model
 * eval and excluded here on purpose.
 *
 * NOTE ON REALITY: every fixture is a clean synthetic render. This proves the
 * pipeline and catches regressions when the model version moves under us. It is
 * NOT evidence about real photographs — that needs a hand-labelled set of real
 * labels, which is the one dataset this repository still lacks.
 */

import { GOVERNMENT_WARNING } from "../lib/warning.ts";
import type { ApplicationSubmission, Verdict } from "../lib/types.ts";

/** The statute with a title-cased heading, as the title-case fixture prints it. */
const TITLE_CASE_WARNING = GOVERNMENT_WARNING.replace(
  "GOVERNMENT WARNING:",
  "Government Warning:",
);

const OLD_TOM_APP: ApplicationSubmission = {
  brandName: "OLD TOM DISTILLERY",
  classType: "Kentucky Straight Bourbon Whiskey",
  alcoholContent: "45% Alc./Vol. (90 Proof)",
  netContents: "750 mL",
};

export interface ExpectedTranscription {
  brandName: string | null;
  classType: string | null;
  alcoholContent: string | null;
  netContents: string | null;
  bottlerAddress: string | null;
  countryOfOrigin: string | null;
  warningText: string | null;
  headingAllCaps: boolean | null;
  headingBold: boolean | null;
}

export interface EvalCase {
  fixture: string;
  /** The application data this label is checked against. */
  application: ApplicationSubmission;
  /** Overall verdict the transcription should produce (type size excluded). */
  expectedVerdict: Verdict;
  /** What the model should transcribe, verbatim. */
  expected: ExpectedTranscription;
}

/** Shorthand for the common case: a clean Old Tom label with a compliant warning. */
function oldTomLabel(over: Partial<ExpectedTranscription> = {}): ExpectedTranscription {
  return {
    brandName: "OLD TOM DISTILLERY",
    classType: "Kentucky Straight Bourbon Whiskey",
    alcoholContent: "45% Alc./Vol. (90 Proof)",
    netContents: "750 mL",
    bottlerAddress: null,
    countryOfOrigin: null,
    warningText: GOVERNMENT_WARNING,
    headingAllCaps: true,
    headingBold: true,
    ...over,
  };
}

export const CASES: EvalCase[] = [
  {
    fixture: "old-tom.png",
    application: OLD_TOM_APP,
    expectedVerdict: "PASS",
    expected: oldTomLabel(),
  },
  {
    fixture: "title-case-warning.png",
    application: OLD_TOM_APP,
    expectedVerdict: "FAIL", // heading is not all-caps
    expected: oldTomLabel({ warningText: TITLE_CASE_WARNING, headingAllCaps: false }),
  },
  {
    fixture: "unbolded-warning.png",
    application: OLD_TOM_APP,
    expectedVerdict: "FAIL", // heading is not bold
    expected: oldTomLabel({ headingBold: false }),
  },
  {
    fixture: "wrong-abv.png",
    application: OLD_TOM_APP,
    expectedVerdict: "FAIL", // label 40% vs application 45%
    expected: oldTomLabel({ alcoholContent: "40% Alc./Vol. (80 Proof)" }),
  },
  {
    // Case variance (STONE'S THROW vs Stone's Throw), unit variance (0.75 L vs
    // 750 mL) and a 7-degree tilt in one label — all should resolve to PASS.
    fixture: "stones-throw-tilted.png",
    application: {
      brandName: "Stone's Throw",
      classType: "Straight Rye Whiskey",
      alcoholContent: "50% Alc./Vol. (100 Proof)",
      netContents: "750 mL",
    },
    expectedVerdict: "PASS",
    expected: {
      brandName: "STONE'S THROW",
      classType: "Straight Rye Whiskey",
      alcoholContent: "50% Alc./Vol. (100 Proof)",
      netContents: "0.75 L",
      bottlerAddress: null,
      countryOfOrigin: null,
      warningText: GOVERNMENT_WARNING,
      headingAllCaps: true,
      headingBold: true,
    },
  },
  {
    fixture: "imported-scotch.png",
    application: {
      brandName: "GLEN CAIRNGORM",
      classType: "Single Malt Scotch Whisky",
      alcoholContent: "43% Alc./Vol. (86 Proof)",
      netContents: "750 mL",
      bottlerAddress: "Imported and bottled by Cairngorm Imports Ltd., Portland, OR",
      countryOfOrigin: "Product of Scotland",
    },
    expectedVerdict: "PASS",
    expected: {
      brandName: "GLEN CAIRNGORM",
      classType: "Single Malt Scotch Whisky",
      alcoholContent: "43% Alc./Vol. (86 Proof)",
      netContents: "750 mL",
      bottlerAddress: "Imported and bottled by Cairngorm Imports Ltd., Portland, OR",
      countryOfOrigin: "Product of Scotland",
      warningText: GOVERNMENT_WARNING,
      headingAllCaps: true,
      headingBold: true,
    },
  },
  {
    // Transcription is a clean Old Tom; the interesting part of this fixture is
    // its larger warning type, which is a CV check, not a model output. As a
    // model case it should read exactly like old-tom and verify to PASS.
    fixture: "compliant-warning.png",
    application: OLD_TOM_APP,
    expectedVerdict: "PASS",
    expected: oldTomLabel(),
  },
  {
    // Likewise: the model reads this label fine. Its undersized warning is
    // caught by the type-size check, which is excluded from a model eval.
    fixture: "tiny-warning.png",
    application: OLD_TOM_APP,
    expectedVerdict: "PASS",
    expected: oldTomLabel(),
  },
];
