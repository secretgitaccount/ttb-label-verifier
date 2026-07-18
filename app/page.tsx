"use client";

import { useState } from "react";
import { SingleCheck } from "@/components/SingleCheck";
import { BatchCheck } from "@/components/BatchCheck";

type Mode = "single" | "batch";

export default function Home() {
  const [mode, setMode] = useState<Mode>("single");

  return (
    <div className="space-y-8">
      <div role="tablist" aria-label="Choose how many labels to check" className="flex gap-3">
        {(
          [
            ["single", "One label"],
            ["batch", "Many labels"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={mode === value}
            onClick={() => setMode(value)}
            className={`rounded-t border-b-4 px-6 py-3 text-lg font-semibold ${
              mode === value
                ? "border-blue-800 bg-white"
                : "border-transparent text-slate-600 hover:bg-white/60"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "single" ? <SingleCheck /> : <BatchCheck />}
    </div>
  );
}
