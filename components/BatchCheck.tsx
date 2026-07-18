"use client";

import { useMemo, useState } from "react";
import { parseManifest } from "@/lib/csv";
import type { BatchRow, Verdict } from "@/lib/types";
import { ResultPanel } from "./ResultPanel";
import { VerdictChip } from "./Verdict";
import { mapWithConcurrency, verifyLabel } from "./verifyRequest";

/** Keeps the queue moving without tripping API rate limits. */
const CONCURRENCY = 6;

const SAMPLE_CSV = `file_name,brand_name,class_type,alcohol_content,net_contents
old-tom.jpg,OLD TOM DISTILLERY,Kentucky Straight Bourbon Whiskey,45% Alc./Vol. (90 Proof),750 mL`;

export function BatchCheck() {
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [images, setImages] = useState<Map<string, File>>(new Map());
  const [manifestErrors, setManifestErrors] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);

  const done = rows.filter((row) => row.result || row.error).length;

  const tally = useMemo(() => {
    const counts: Record<Verdict | "ERROR", number> = {
      PASS: 0,
      REVIEW: 0,
      FAIL: 0,
      ERROR: 0,
    };
    for (const row of rows) {
      if (row.error) counts.ERROR++;
      else if (row.result) counts[row.result.verdict]++;
    }
    return counts;
  }, [rows]);

  async function handleManifest(file: File | null) {
    if (!file) return;
    const { records, errors } = parseManifest(await file.text());
    setManifestErrors(errors);
    setRows(
      records.map(({ fileName, ...application }) => ({ fileName, application })),
    );
    setOpenRow(null);
  }

  function handleImages(fileList: FileList | null) {
    const next = new Map<string, File>();
    for (const file of Array.from(fileList ?? [])) {
      next.set(file.name.toLowerCase(), file);
    }
    setImages(next);
  }

  const missingImages = rows.filter((row) => !images.get(row.fileName.toLowerCase()));

  async function run() {
    setRunning(true);
    setRows((current) =>
      current.map((row) => ({ ...row, result: undefined, error: undefined })),
    );

    const queue = [...rows];
    await mapWithConcurrency(queue, CONCURRENCY, async (row, index) => {
      const image = images.get(row.fileName.toLowerCase());
      const update = (patch: Partial<BatchRow>) =>
        setRows((current) =>
          current.map((existing, i) => (i === index ? { ...existing, ...patch } : existing)),
        );

      if (!image) {
        update({ error: "No image with this file name was uploaded." });
        return;
      }
      try {
        update({ result: await verifyLabel(image, row.application) });
      } catch (caught) {
        update({
          error: caught instanceof Error ? caught.message : "Check failed.",
        });
      }
    });

    setRunning(false);
  }

  function exportCsv() {
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const lines = [
      "file_name,brand_name,result,details",
      ...rows.map((row) => {
        const outcome = row.error
          ? "ERROR"
          : (row.result?.verdict ?? "NOT CHECKED");
        const details = row.error
          ? row.error
          : (row.result?.fields ?? [])
              .filter((field) => field.verdict !== "PASS")
              .map((field) => `${field.title}: ${field.reason}`)
              .join(" | ");
        return [row.fileName, row.application.brandName, outcome, details]
          .map(escape)
          .join(",");
      }),
    ];

    const url = URL.createObjectURL(
      new Blob([lines.join("\n")], { type: "text/csv" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "label-check-results.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-300 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Step 1 &middot; The application list</h2>
        <p className="mt-1 text-slate-600">
          A CSV with one row per application and these columns:{" "}
          <code className="rounded bg-slate-200 px-1.5 py-0.5 text-[0.85rem]">
            file_name, brand_name, class_type, alcohol_content, net_contents
          </code>
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => handleManifest(event.target.files?.[0] ?? null)}
          className="mt-4 block w-full text-slate-700 file:mr-4 file:cursor-pointer file:rounded file:border-0 file:bg-blue-800 file:px-5 file:py-2.5 file:font-semibold file:text-white hover:file:bg-blue-900"
        />
        <details className="mt-3">
          <summary className="cursor-pointer text-slate-600 underline">
            Show an example
          </summary>
          <pre className="mt-2 overflow-x-auto rounded bg-slate-100 p-3 text-[0.8rem]">
            {SAMPLE_CSV}
          </pre>
        </details>
        {manifestErrors.length > 0 && (
          <ul className="mt-4 space-y-1 rounded border-l-8 border-fail bg-fail-bg px-4 py-3">
            {manifestErrors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-slate-300 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Step 2 &middot; The label images</h2>
        <p className="mt-1 text-slate-600">
          Select every image at once. File names must match the{" "}
          <code className="rounded bg-slate-200 px-1.5 py-0.5 text-[0.85rem]">
            file_name
          </code>{" "}
          column.
        </p>
        <input
          type="file"
          multiple
          accept="image/png,image/jpeg,image/gif,image/webp"
          onChange={(event) => handleImages(event.target.files)}
          className="mt-4 block w-full text-slate-700 file:mr-4 file:cursor-pointer file:rounded file:border-0 file:bg-blue-800 file:px-5 file:py-2.5 file:font-semibold file:text-white hover:file:bg-blue-900"
        />
        {rows.length > 0 && (
          <p className="mt-3 text-slate-700">
            {rows.length} application{rows.length === 1 ? "" : "s"} loaded,{" "}
            {images.size} image{images.size === 1 ? "" : "s"} selected.
            {missingImages.length > 0 && (
              <strong className="text-fail">
                {" "}
                {missingImages.length} application
                {missingImages.length === 1 ? " has" : "s have"} no matching image.
              </strong>
            )}
          </p>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={run}
          disabled={running || rows.length === 0 || images.size === 0}
          className="rounded bg-blue-800 px-8 py-3.5 text-lg font-semibold text-white hover:bg-blue-900 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {running ? `Checking ${done} of ${rows.length}…` : `Check all ${rows.length || ""} labels`.trim()}
        </button>
        {done > 0 && !running && (
          <button
            type="button"
            onClick={exportCsv}
            className="rounded border-2 border-slate-400 px-6 py-3 font-semibold hover:bg-slate-200"
          >
            Download results as CSV
          </button>
        )}
      </div>

      {rows.length > 0 && (
        <section className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-slate-200 px-5 py-3" aria-live="polite">
            <span>
              <strong>{done}</strong> of {rows.length} checked
            </span>
            <span className="text-pass">{tally.PASS} matched</span>
            <span className="text-review">{tally.REVIEW} need review</span>
            <span className="text-fail">{tally.FAIL} with problems</span>
            {tally.ERROR > 0 && <span className="text-slate-600">{tally.ERROR} could not be checked</span>}
          </div>

          <ul className="divide-y divide-slate-200">
            {rows.map((row) => {
              const isOpen = openRow === row.fileName;
              return (
                <li key={row.fileName}>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                    <span className="font-mono text-[0.9rem]">{row.fileName}</span>
                    <span className="flex-1 text-slate-600">
                      {row.application.brandName}
                    </span>
                    {row.error ? (
                      <span className="text-fail">{row.error}</span>
                    ) : row.result ? (
                      <>
                        <VerdictChip verdict={row.result.verdict} />
                        <button
                          type="button"
                          onClick={() => setOpenRow(isOpen ? null : row.fileName)}
                          className="underline"
                          aria-expanded={isOpen}
                        >
                          {isOpen ? "Hide details" : "Details"}
                        </button>
                      </>
                    ) : (
                      <span className="text-slate-500">{running ? "Waiting…" : "Not checked"}</span>
                    )}
                  </div>
                  {isOpen && row.result && (
                    <div className="border-t border-slate-200 bg-slate-50 p-5">
                      <ResultPanel result={row.result} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
