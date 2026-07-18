import type { VerificationResult } from "@/lib/types";
import { VerdictBanner, VerdictChip } from "./Verdict";

export function ResultPanel({ result }: { result: VerificationResult }) {
  return (
    <section
      aria-label="Verification result"
      className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm"
    >
      <VerdictBanner verdict={result.verdict} elapsedMs={result.elapsedMs} />

      {!result.imageQuality.readable && (
        <p className="border-b border-slate-200 bg-amber-50 px-5 py-3 text-slate-800">
          <strong>Part of this image was hard to read.</strong>{" "}
          {result.imageQuality.issues.length > 0
            ? `${result.imageQuality.issues.join("; ")}. `
            : ""}
          Consider requesting a clearer photograph before deciding.
        </p>
      )}

      <ul className="divide-y divide-slate-200">
        {result.fields.map((field) => (
          <li key={field.field} className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-lg font-semibold">{field.title}</h3>
              <VerdictChip verdict={field.verdict} />
            </div>

            <p className="mt-1 text-slate-700">{field.reason}</p>

            {field.field !== "governmentWarning" && (
              <dl className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-[9rem_1fr]">
                <dt className="text-sm font-medium text-slate-500">Application</dt>
                <dd className="font-mono text-[0.95rem]">{field.expected || "—"}</dd>
                <dt className="text-sm font-medium text-slate-500">On the label</dt>
                <dd className="font-mono text-[0.95rem]">{field.found ?? "not found"}</dd>
              </dl>
            )}

            {field.field === "governmentWarning" && field.found && (
              <div className="mt-3">
                <p className="text-sm font-medium text-slate-500">
                  Warning text as printed on the label
                </p>
                <blockquote className="mt-1 border-l-4 border-slate-300 py-1 pl-3 font-mono text-[0.9rem] leading-relaxed">
                  {field.found}
                </blockquote>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
