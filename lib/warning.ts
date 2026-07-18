/**
 * The Government Health Warning Statement, 27 CFR 16.21.
 *
 * This text is prescribed word-for-word by regulation. We compare against it
 * exactly (modulo whitespace), because "close enough" is a rejection — Jenny
 * caught an application last month whose only defect was title case.
 */
export const GOVERNMENT_WARNING =
  "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not " +
  "drink alcoholic beverages during pregnancy because of the risk of birth " +
  "defects. (2) Consumption of alcoholic beverages impairs your ability to " +
  "drive a car or operate machinery, and may cause health problems.";

/** Collapse runs of whitespace so line breaks in the artwork don't matter. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export interface WarningCheck {
  /** Text matches the statute exactly (ignoring line breaks). */
  textExact: boolean;
  /** "GOVERNMENT WARNING:" appears in all caps as required. */
  headingAllCaps: boolean;
  /** First substantive difference, phrased for an agent, or null if exact. */
  discrepancy: string | null;
}

export function checkWarningText(found: string): WarningCheck {
  const actual = collapseWhitespace(found);
  const expected = collapseWhitespace(GOVERNMENT_WARNING);

  const headingAllCaps = /^GOVERNMENT WARNING:/.test(actual);

  if (actual === expected) {
    return { textExact: true, headingAllCaps, discrepancy: null };
  }

  // Case-insensitive equality means the only defect is capitalization —
  // worth calling out precisely, since it's the single most common violation.
  if (actual.toLowerCase() === expected.toLowerCase()) {
    return {
      textExact: false,
      headingAllCaps,
      discrepancy: headingAllCaps
        ? "Wording is correct but capitalization differs from the required text."
        : 'The "GOVERNMENT WARNING:" heading is not in all capital letters.',
    };
  }

  return {
    textExact: false,
    headingAllCaps,
    discrepancy: describeFirstDifference(actual, expected),
  };
}

/**
 * Point the agent at the first word that diverges, rather than making them
 * eyeball two paragraphs. Falls back to a length note if one text is a prefix
 * of the other (i.e. the warning is truncated or has trailing additions).
 */
function describeFirstDifference(actual: string, expected: string): string {
  const actualWords = actual.split(" ");
  const expectedWords = expected.split(" ");

  for (let i = 0; i < Math.max(actualWords.length, expectedWords.length); i++) {
    const a = actualWords[i];
    const e = expectedWords[i];
    if (a === e) continue;

    if (a === undefined) {
      return `Warning text is cut short. Expected it to continue "…${expectedWords
        .slice(i, i + 6)
        .join(" ")}".`;
    }
    if (e === undefined) {
      return `Warning text has extra wording after the required statement: "${actualWords
        .slice(i, i + 6)
        .join(" ")}…".`;
    }
    const context = expectedWords.slice(Math.max(0, i - 4), i).join(" ");
    return `Wording differs${
      context ? ` after "${context}"` : ""
    }: label reads "${a}", regulation requires "${e}".`;
  }

  return "Warning text does not match the required statement.";
}
