/** Shared types for the label verification pipeline. */

export type FieldKey =
  | "brandName"
  | "classType"
  | "alcoholContent"
  | "netContents"
  | "governmentWarning";

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

/** Raw, verbatim reading of the label artwork. No judgement applied here. */
export interface ExtractedLabel {
  brandName: string | null;
  classType: string | null;
  alcoholContent: string | null;
  netContents: string | null;
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
  application: ApplicationRecord;
  result?: VerificationResult;
  error?: string;
}
