import type { Verdict } from "@/lib/types";

const STYLES: Record<Verdict, { label: string; chip: string; panel: string }> = {
  PASS: {
    label: "Everything matches",
    chip: "bg-pass text-white",
    panel: "border-pass bg-pass-bg",
  },
  REVIEW: {
    label: "Needs your review",
    chip: "bg-review text-white",
    panel: "border-review bg-review-bg",
  },
  FAIL: {
    label: "Problems found",
    chip: "bg-fail text-white",
    panel: "border-fail bg-fail-bg",
  },
};

/** Small status word used inline in field rows and batch tables. */
export function VerdictChip({ verdict }: { verdict: Verdict }) {
  const word = verdict === "PASS" ? "Match" : verdict === "REVIEW" ? "Check" : "Problem";
  return (
    <span
      className={`inline-block rounded px-2.5 py-1 text-sm font-semibold ${STYLES[verdict].chip}`}
    >
      {word}
    </span>
  );
}

/** The one-glance answer at the top of a result. */
export function VerdictBanner({
  verdict,
  elapsedMs,
}: {
  verdict: Verdict;
  elapsedMs: number;
}) {
  const style = STYLES[verdict];
  return (
    <div className={`flex items-center justify-between gap-4 border-l-8 ${style.panel} px-5 py-4`}>
      <p className="text-xl font-bold">{style.label}</p>
      <p className="shrink-0 text-sm text-slate-600">
        Checked in {(elapsedMs / 1000).toFixed(1)}s
      </p>
    </div>
  );
}

export const verdictStyles = STYLES;
