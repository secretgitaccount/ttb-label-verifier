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

export interface VerificationResult {
  verdict: Verdict;
  fields: FieldResult[];
  imageQuality: ExtractedLabel["imageQuality"];
  elapsedMs: number;
}

export interface BatchRow {
  fileName: string;
  application: ApplicationSubmission;
  result?: VerificationResult;
  error?: string;
}
