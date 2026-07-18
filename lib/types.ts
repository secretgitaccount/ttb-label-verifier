/** Shared types for the label verification pipeline. */

export type FieldKey =
  | "brandName"
  | "classType"
  | "alcoholContent"
  | "netContents"
  | "governmentWarning"
  | "bottlerAddress"
  | "countryOfOrigin";

/**
 * PASS  - matches the application; no agent action needed.
 * REVIEW - close but not identical; a human decides (Dave's "STONE'S THROW" case).
 * FAIL  - clear mismatch or a missing mandatory element.
 */
export type Verdict = "PASS" | "REVIEW" | "FAIL";

/** What the applicant claims, from the COLA application form. */
export interface ApplicationRecord {
  brandName: string;
  classType: string;
  alcoholContent: string;
  netContents: string;
}

/**
 * Elements TTB requires only in some circumstances. They are kept off
 * ApplicationRecord itself so that `keyof ApplicationRecord` stays the set of
 * always-required fields the form and CSV importer iterate over — a UI that
 * demands every key would otherwise start demanding a country of origin from
 * domestic applicants.
 *
 * Each is compared only when the application supplies it; an absent value
 * asserts nothing. See compareOptionalText in compare.ts.
 */
export interface OptionalApplicationFields {
  /** Name and address of the bottler/producer, if the application states one. */
  bottlerAddress?: string;
  /** Imports only. A domestic label is never failed for lacking one. */
  countryOfOrigin?: string;
  /**
   * Physical width of the printed label in millimetres, if the application
   * states one. Held as a string like every other field here so the form, the
   * CSV importer and the multipart request all keep the single representation
   * they already use; route.ts parses it to a number at the boundary.
   *
   * 27 CFR 16.22 is written in millimetres and an image has no inherent scale,
   * so without this the type-size check reports "not assessed" and asserts
   * nothing. It is never inferred: guessing a scale is how the first attempt at
   * this requirement produced confident wrong rejections.
   */
  labelWidthMm?: string;
}

/** What verification actually compares against: the form plus any optional elements. */
export type ApplicationSubmission = ApplicationRecord & OptionalApplicationFields;

/** Raw, verbatim reading of the label artwork. No judgement applied here. */
export interface ExtractedLabel {
  brandName: string | null;
  classType: string | null;
  alcoholContent: string | null;
  netContents: string | null;
  /** Name and address of the bottler/producer as printed, or null if absent. */
  bottlerAddress: string | null;
  /** Country of origin statement as printed (imports), or null if absent. */
  countryOfOrigin: string | null;
  governmentWarning: {
    present: boolean;
    /** Transcribed exactly as printed, including any misspellings. */
    text: string | null;
    /** Is the "GOVERNMENT WARNING:" heading printed in all caps? */
    headingAllCaps: boolean | null;
    /**
     * Is the heading printed in bold (heavier than the body of the warning)?
     * null means the model could not tell — an uncertain signal, not a defect.
     */
    headingBold: boolean | null;
  };
  imageQuality: {
    readable: boolean;
    /** e.g. "glare", "blurry", "steep angle", "low resolution" */
    issues: string[];
  };
}

export interface FieldResult {
  field: FieldKey;
  /** Human label for the UI, e.g. "Brand Name". */
  title: string;
  expected: string | null;
  found: string | null;
  verdict: Verdict;
  /** Plain-English explanation shown to the agent. */
  reason: string;
}

/**
 * The Government Warning type-size check (FR-10, 27 CFR 16.22).
 *
 * Kept off `fields` on purpose. Every FieldResult carries a Verdict, and this
 * check has a fourth outcome the other five cannot have: *not assessed*. There
 * is no scale in an image, so without a stated physical label width — or on
 * artwork that is not square-on — the honest output is no claim at all, and
 * widening Verdict with a "not assessed" member would push that case into every
 * roll-up, chip and banner in the app to serve one field. A separate optional
 * shape says the same thing without making the other five checks pretend the
 * possibility exists.
 *
 * Structurally identical to the type-size measurement in lib/typesize.ts but
 * declared here rather than re-exported, because types.ts is imported by client
 * components and lib/typesize.ts pulls in sharp, which must not reach the
 * browser bundle.
 */
export type TypeSizeAssessment =
  | {
      assessed: false;
      /** Plain English: why no claim is being made. */
      reason: string;
    }
  | {
      assessed: true;
      verdict: Verdict;
      reason: string;
      /** Centre estimate of the warning's cap height, in millimetres. */
      measuredMm: number;
      /** Half-width of the interval around measuredMm. Never omit it in the UI. */
      uncertaintyMm: number;
      /** The minimum this label's net contents requires. */
      requiredMm: number;
      /** Cap height in image pixels, and the label width it was scaled against. */
      capHeightPx: number;
      labelWidthPx: number;
    };

export interface VerificationResult {
  verdict: Verdict;
  fields: FieldResult[];
  imageQuality: ExtractedLabel["imageQuality"];
  elapsedMs: number;
  /**
   * Present whenever a label image was measured or a measurement was refused.
   * A refusal contributes nothing to `verdict`.
   */
  typeSize?: TypeSizeAssessment;
}

export interface BatchRow {
  fileName: string;
  application: ApplicationSubmission;
  result?: VerificationResult;
  error?: string;
}
