/**
 * Minimal RFC 4180 CSV reader for batch application manifests.
 *
 * Importers send us spreadsheets exported from their own systems, so quoted
 * fields containing commas and embedded newlines are routine.
 */

import type { ApplicationSubmission, OptionalApplicationFields } from "./types.ts";

export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  // Strip a UTF-8 BOM; Excel adds one on export.
  const text = input.replace(/^﻿/, "");

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

type ManifestKey = keyof ApplicationSubmission | "fileName";

/**
 * Columns an importer may supply and may equally leave out. They are listed
 * apart from ALL_KEYS on purpose: ALL_KEYS drives both the "missing columns"
 * check and the per-row blank check, so adding an optional key to it would
 * reject every domestic manifest ever exported — including samples/manifest.csv.
 */
const OPTIONAL_KEYS = ["bottlerAddress", "countryOfOrigin"] as const satisfies
  readonly (keyof OptionalApplicationFields)[];

/** Column headings we accept, normalized to lowercase alphanumerics. */
const COLUMN_ALIASES: Record<string, ManifestKey> = {
  filename: "fileName",
  file: "fileName",
  image: "fileName",
  imagefilename: "fileName",
  brandname: "brandName",
  brand: "brandName",
  classtype: "classType",
  class: "classType",
  type: "classType",
  alcoholcontent: "alcoholContent",
  alcohol: "alcoholContent",
  abv: "alcoholContent",
  netcontents: "netContents",
  net: "netContents",
  volume: "netContents",
  bottleraddress: "bottlerAddress",
  bottler: "bottlerAddress",
  bottlername: "bottlerAddress",
  bottlernameandaddress: "bottlerAddress",
  producer: "bottlerAddress",
  nameandaddress: "bottlerAddress",
  countryoforigin: "countryOfOrigin",
  country: "countryOfOrigin",
  origin: "countryOfOrigin",
};

const ALL_KEYS: ManifestKey[] = [
  "fileName",
  "brandName",
  "classType",
  "alcoholContent",
  "netContents",
];

export interface ParsedManifest {
  records: (ApplicationSubmission & { fileName: string })[];
  errors: string[];
}

export function parseManifest(csvText: string): ParsedManifest {
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    return {
      records: [],
      errors: ["The CSV needs a header row and at least one application row."],
    };
  }

  const [header, ...dataRows] = rows;
  const columns = header.map(
    (cell) => COLUMN_ALIASES[cell.trim().toLowerCase().replace(/[^a-z0-9]/g, "")],
  );

  const missingColumns = ALL_KEYS.filter((key) => !columns.includes(key));
  if (missingColumns.length > 0) {
    return {
      records: [],
      errors: [
        `CSV is missing these columns: ${missingColumns.join(", ")}. ` +
          "Expected: file_name, brand_name, class_type, alcohol_content, net_contents.",
      ],
    };
  }

  const records: ParsedManifest["records"] = [];
  const errors: string[] = [];

  dataRows.forEach((cells, index) => {
    const record: Partial<Record<ManifestKey, string>> = {};
    columns.forEach((key, columnIndex) => {
      if (key) record[key] = (cells[columnIndex] ?? "").trim();
    });

    const blank = ALL_KEYS.filter((key) => !record[key]);
    if (blank.length > 0) {
      errors.push(`Row ${index + 2}: missing ${blank.join(", ")}.`);
      return;
    }

    const parsed: ApplicationSubmission & { fileName: string } = {
      fileName: record.fileName!,
      brandName: record.brandName!,
      classType: record.classType!,
      alcoholContent: record.alcoholContent!,
      netContents: record.netContents!,
    };

    // Left undefined when the column is absent or the cell is blank, so that
    // "the importer said nothing" stays distinguishable from "the importer
    // said empty". compare.ts asserts nothing about a field it never receives.
    for (const key of OPTIONAL_KEYS) {
      const value = record[key];
      if (value) parsed[key] = value;
    }

    records.push(parsed);
  });

  return { records, errors };
}
