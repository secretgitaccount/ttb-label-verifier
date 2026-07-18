/**
 * Deterministic comparison of application data against what was read off the
 * label.
 *
 * The model's only job is transcription. Every match/mismatch decision is made
 * here, in plain TypeScript, so a compliance verdict is reproducible and can be
 * audited line-by-line rather than re-litigated with a prompt.
 */

import type {
  ApplicationSubmission,
  ExtractedLabel,
  FieldResult,
  VerificationResult,
  Verdict,
} from "./types.ts";
import { checkWarningText, collapseWhitespace, GOVERNMENT_WARNING } from "./warning.ts";

/** Strip case, punctuation and spacing noise: "STONE'S THROW" ~ "Stone's Throw". */
export function normalize(text: string): string {
  return text
    .toUpperCase()
    .replace(/[‘’“”]/g, "'") // smart quotes -> straight
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/** Levenshtein distance, iterative two-row form. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** 1.0 = identical, 0.0 = nothing in common. */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - editDistance(a, b) / longest;
}

/** Anything at or above this is "probably the same thing, ask a human". */
const REVIEW_THRESHOLD = 0.82;

function compareText(
  field: FieldResult["field"],
  title: string,
  expected: string,
  found: string | null,
): FieldResult {
  const base = { field, title, expected, found };

  if (!found) {
    return {
      ...base,
      verdict: "FAIL",
      reason: `${title} does not appear on the label.`,
    };
  }

  if (expected.trim() === found.trim()) {
    return { ...base, verdict: "PASS", reason: "Matches the application exactly." };
  }

  const normExpected = normalize(expected);
  const normFound = normalize(found);

  if (normExpected === normFound) {
    // Dave's case: same words, different styling. Not a defect on its own.
    return {
      ...base,
      verdict: "PASS",
      reason: "Matches, apart from capitalization or punctuation styling.",
    };
  }

  const score = similarity(normExpected, normFound);
  if (score >= REVIEW_THRESHOLD) {
    return {
      ...base,
      verdict: "REVIEW",
      reason: `Close but not identical (${Math.round(
        score * 100,
      )}% similar). Confirm this is the same ${title.toLowerCase()}.`,
    };
  }

  return {
    ...base,
    verdict: "FAIL",
    reason: `Label says "${found}", application says "${expected}".`,
  };
}

/**
 * A field that is only checked when the application asserts a value for it.
 *
 * TTB does not require every element on every label — country of origin is an
 * import-only statement, and a bottler address may sit on a back label that was
 * never photographed. So an absent value on the application means we make no
 * claim at all (the caller omits the field), and an absent value on the *label*
 * for something the application does assert is a REVIEW, not a FAIL: we cannot
 * tell "not on the product" from "not in this photograph", and an agent can.
 * A value that is present but contradicts the application is a real mismatch
 * and falls through to compareText, which can still FAIL it.
 */
function compareOptionalText(
  field: FieldResult["field"],
  title: string,
  expected: string,
  found: string | null,
): FieldResult {
  if (!found) {
    return {
      field,
      title,
      expected,
      found,
      verdict: "REVIEW",
      reason: `The application states "${expected}" but no ${title.toLowerCase()} was read from this artwork. Confirm whether it appears elsewhere on the packaging.`,
    };
  }
  return compareText(field, title, expected, found);
}

/** Pull the ABV percentage out of strings like "45% Alc./Vol. (90 Proof)". */
export function parseAbv(text: string): number | null {
  const percent = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (percent) return parseFloat(percent[1]);

  // Some labels state proof only; ABV is half the proof.
  const proof = text.match(/(\d+(?:\.\d+)?)\s*proof/i);
  if (proof) return parseFloat(proof[1]) / 2;

  return null;
}

/** Proof, when stated, must be exactly twice the ABV. */
function parseProof(text: string): number | null {
  const proof = text.match(/(\d+(?:\.\d+)?)\s*proof/i);
  return proof ? parseFloat(proof[1]) : null;
}

/**
 * TTB permits a small labelling tolerance for distilled spirits (27 CFR
 * 5.65). We treat anything inside it as a judgement call rather than an
 * automatic failure, and anything outside it as a hard mismatch.
 */
const ABV_TOLERANCE = 0.15;

function compareAbv(expected: string, found: string | null): FieldResult {
  const base = {
    field: "alcoholContent" as const,
    title: "Alcohol Content",
    expected,
    found,
  };

  if (!found) {
    return {
      ...base,
      verdict: "FAIL",
      reason: "No alcohol content statement found on the label.",
    };
  }

  const expectedAbv = parseAbv(expected);
  const foundAbv = parseAbv(found);

  if (expectedAbv === null || foundAbv === null) {
    return compareText("alcoholContent", "Alcohol Content", expected, found);
  }

  // A label that says "45% Alc./Vol. (80 Proof)" is internally inconsistent
  // regardless of what the application claims.
  const statedProof = parseProof(found);
  if (statedProof !== null && Math.abs(statedProof - foundAbv * 2) > 0.2) {
    return {
      ...base,
      verdict: "FAIL",
      reason: `Label is internally inconsistent: ${foundAbv}% alcohol by volume would be ${(
        foundAbv * 2
      ).toFixed(0)} proof, but the label states ${statedProof} proof.`,
    };
  }

  const delta = Math.abs(expectedAbv - foundAbv);
  if (delta === 0) {
    return { ...base, verdict: "PASS", reason: `Both state ${foundAbv}% alcohol by volume.` };
  }
  if (delta <= ABV_TOLERANCE) {
    return {
      ...base,
      verdict: "REVIEW",
      reason: `Label states ${foundAbv}%, application states ${expectedAbv}%. Within the ${ABV_TOLERANCE}% labelling tolerance.`,
    };
  }
  return {
    ...base,
    verdict: "FAIL",
    reason: `Label states ${foundAbv}% alcohol by volume, application states ${expectedAbv}%.`,
  };
}

/** Convert a net contents statement to millilitres for comparison. */
export function parseVolumeMl(text: string): number | null {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(ml|milliliters?|millilitres?|l|liters?|litres?|cl|centiliters?|centilitres?)\b/i);
  if (!match) return null;

  const amount = parseFloat(match[1].replace(",", "."));
  const unit = match[2].toLowerCase();

  if (unit.startsWith("ml") || unit.startsWith("milli")) return amount;
  if (unit.startsWith("cl") || unit.startsWith("centi")) return amount * 10;
  return amount * 1000; // litres
}

function compareNetContents(expected: string, found: string | null): FieldResult {
  const base = {
    field: "netContents" as const,
    title: "Net Contents",
    expected,
    found,
  };

  if (!found) {
    return { ...base, verdict: "FAIL", reason: "No net contents statement found on the label." };
  }

  const expectedMl = parseVolumeMl(expected);
  const foundMl = parseVolumeMl(found);

  if (expectedMl === null || foundMl === null) {
    return compareText("netContents", "Net Contents", expected, found);
  }

  if (expectedMl === foundMl) {
    const styled = expected.trim() !== found.trim();
    return {
      ...base,
      verdict: "PASS",
      reason: styled
        ? `Both equal ${foundMl} mL, written differently.`
        : "Matches the application exactly.",
    };
  }

  return {
    ...base,
    verdict: "FAIL",
    reason: `Label states ${found} (${foundMl} mL), application states ${expected} (${expectedMl} mL).`,
  };
}

function compareWarning(label: ExtractedLabel): FieldResult {
  const base = {
    field: "governmentWarning" as const,
    title: "Government Warning",
    expected: "Exact statutory text, 27 CFR 16.21",
    found: label.governmentWarning.text,
  };

  if (!label.governmentWarning.present || !label.governmentWarning.text) {
    return {
      ...base,
      verdict: "FAIL",
      reason: "The mandatory Government Health Warning is missing from the label.",
    };
  }

  const check = checkWarningText(label.governmentWarning.text);

  // Prefer the model's direct reading of the artwork for the caps question —
  // it can see rendering that survives transcription poorly.
  const headingAllCaps = label.governmentWarning.headingAllCaps ?? check.headingAllCaps;
  const headingBold = label.governmentWarning.headingBold;

  // A label can be wrong in more than one way at once. Reporting only the
  // first defect sends the applicant an incomplete correction and buys a
  // second bad submission, so collect every hard defect and report them all.
  // Order is severity order: altered wording, then capitalisation, then weight.
  const defects: string[] = [];

  // Is the transcription the statutory text modulo capitalisation? If so the
  // only textual defect is a caps defect, and the caps branch below already
  // says so — don't say it twice.
  const differsOnlyByCase =
    collapseWhitespace(label.governmentWarning.text).toLowerCase() ===
    collapseWhitespace(GOVERNMENT_WARNING).toLowerCase();

  if (!check.textExact && !differsOnlyByCase) {
    defects.push(
      check.discrepancy ?? "Warning text does not match the required statement.",
    );
  }

  if (!headingAllCaps) {
    defects.push('The "GOVERNMENT WARNING:" heading must be in all capital letters.');
  } else if (!check.textExact && differsOnlyByCase) {
    defects.push("Wording is correct but capitalization differs from the required text.");
  }

  // 27 CFR 16.21 requires the heading to be bold as well as capitalised, and a
  // correctly-capitalised heading in light type is exactly the false approval
  // this check exists to prevent.
  if (headingBold === false) {
    defects.push('The "GOVERNMENT WARNING:" heading must be printed in bold type.');
  }

  if (defects.length > 0) {
    return { ...base, verdict: "FAIL", reason: defects.join(" ") };
  }

  // Bold is a visual property read off artwork, not text we can re-derive from
  // the transcription — so unlike the caps check there is no second source to
  // fall back on. When the model reports null it is telling us it could not
  // see the difference, and converting that into a FAIL would reject compliant
  // labels for being photographed badly. REVIEW is the honest verdict for an
  // uncertain signal: it never auto-approves, and it puts the one thing a
  // human can settle in front of a human.
  if (headingBold === null || headingBold === undefined) {
    return {
      ...base,
      verdict: "REVIEW",
      reason:
        'Warning text matches, but whether the "GOVERNMENT WARNING:" heading is printed in bold could not be determined from this image. Check the heading weight.',
    };
  }

  return {
    ...base,
    verdict: "PASS",
    reason: "Warning text matches the required statement exactly.",
  };
}

/** Worst verdict wins: any FAIL fails the application. */
function rollUp(fields: FieldResult[]): Verdict {
  if (fields.some((f) => f.verdict === "FAIL")) return "FAIL";
  if (fields.some((f) => f.verdict === "REVIEW")) return "REVIEW";
  return "PASS";
}

export function verify(
  application: ApplicationSubmission,
  label: ExtractedLabel,
  elapsedMs: number,
): VerificationResult {
  const fields: FieldResult[] = [
    compareText("brandName", "Brand Name", application.brandName, label.brandName),
    compareText("classType", "Class / Type", application.classType, label.classType),
    compareAbv(application.alcoholContent, label.alcoholContent),
    compareNetContents(application.netContents, label.netContents),
    compareWarning(label),
  ];

  // Only checked when the application asserts them. Nothing is inferred from
  // their absence: a domestic label with no country of origin is not a defect.
  if (application.bottlerAddress?.trim()) {
    fields.push(
      compareOptionalText(
        "bottlerAddress",
        "Bottler Name and Address",
        application.bottlerAddress.trim(),
        label.bottlerAddress,
      ),
    );
  }
  if (application.countryOfOrigin?.trim()) {
    fields.push(
      compareOptionalText(
        "countryOfOrigin",
        "Country of Origin",
        application.countryOfOrigin.trim(),
        label.countryOfOrigin,
      ),
    );
  }

  let verdict = rollUp(fields);

  // An unreadable photo shouldn't read as a compliance failure — it's a
  // request for a better image. Only soften a FAIL that came from absent
  // fields, never one from a warning-text defect we could actually read.
  if (!label.imageQuality.readable && verdict === "FAIL") {
    const onlyMissingFields = fields.every(
      (f) => f.verdict !== "FAIL" || f.found === null,
    );
    if (onlyMissingFields) verdict = "REVIEW";
  }

  return { verdict, fields, imageQuality: label.imageQuality, elapsedMs };
}
