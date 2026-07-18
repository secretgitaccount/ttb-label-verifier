"use client";

import { useEffect, useState } from "react";
import type {
  ApplicationRecord,
  OptionalApplicationFields,
  VerificationResult,
} from "@/lib/types";
import { ResultPanel } from "./ResultPanel";
import { verifyLabel } from "./verifyRequest";

/**
 * Every box is a controlled input, so the optional ones are held as "" here
 * rather than undefined. verifyLabel drops the blank ones before they are sent.
 */
type FormState = ApplicationRecord & Required<OptionalApplicationFields>;

const EMPTY: FormState = {
  brandName: "",
  classType: "",
  alcoholContent: "",
  netContents: "",
  bottlerAddress: "",
  countryOfOrigin: "",
};

const FIELDS: {
  key: keyof ApplicationRecord;
  label: string;
  placeholder: string;
}[] = [
  { key: "brandName", label: "Brand name", placeholder: "OLD TOM DISTILLERY" },
  {
    key: "classType",
    label: "Class / type",
    placeholder: "Kentucky Straight Bourbon Whiskey",
  },
  {
    key: "alcoholContent",
    label: "Alcohol content",
    placeholder: "45% Alc./Vol. (90 Proof)",
  },
  { key: "netContents", label: "Net contents", placeholder: "750 mL" },
];

/**
 * TTB requires these only in some circumstances — a country of origin is an
 * import-only statement, and many domestic applications state no bottler
 * address here at all. They are kept out of FIELDS so they cannot reach the
 * `ready` check below: a domestic spirits application must submit with both
 * boxes empty.
 */
const OPTIONAL_FIELDS: {
  key: keyof Required<OptionalApplicationFields>;
  label: string;
  placeholder: string;
  hint: string;
}[] = [
  {
    key: "bottlerAddress",
    label: "Bottler name and address",
    placeholder: "Bottled by Old Tom Distillery, Bardstown, KY",
    hint: "Leave blank if the application does not state one.",
  },
  {
    key: "countryOfOrigin",
    label: "Country of origin",
    placeholder: "Product of Scotland",
    hint: "Imported products only. Leave blank for domestic products.",
  },
];

export function SingleCheck() {
  const [application, setApplication] = useState<FormState>(EMPTY);
  const [image, setImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!image) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(image);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const ready =
    image !== null && FIELDS.every(({ key }) => application[key].trim() !== "");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!image || !ready) return;

    setChecking(true);
    setError(null);
    setResult(null);
    try {
      setResult(await verifyLabel(image, application));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setChecking(false);
    }
  }

  function reset() {
    setApplication(EMPTY);
    setImage(null);
    setResult(null);
    setError(null);
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-6">
        <fieldset className="rounded-lg border border-slate-300 bg-white p-6 shadow-sm">
          <legend className="px-2 text-lg font-semibold">
            Step 1 &middot; What the application says
          </legend>
          <div className="grid gap-5 sm:grid-cols-2">
            {FIELDS.map(({ key, label, placeholder }) => (
              <label key={key} className="block">
                <span className="mb-1.5 block font-medium">{label}</span>
                <input
                  type="text"
                  value={application[key]}
                  placeholder={placeholder}
                  onChange={(event) =>
                    setApplication((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                  className="w-full rounded border border-slate-400 px-3 py-2.5 focus:border-blue-700"
                />
              </label>
            ))}
          </div>

          <div className="mt-6 border-t border-slate-200 pt-5">
            <p className="mb-4 font-medium text-slate-700">
              Only if the application states them
            </p>
            <div className="grid gap-5 sm:grid-cols-2">
              {OPTIONAL_FIELDS.map(({ key, label, placeholder, hint }) => (
                <label key={key} className="block">
                  <span className="mb-1.5 block font-medium">
                    {label}{" "}
                    <span className="font-normal text-slate-600">(optional)</span>
                  </span>
                  <input
                    type="text"
                    value={application[key]}
                    placeholder={placeholder}
                    onChange={(event) =>
                      setApplication((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                    className="w-full rounded border border-slate-400 px-3 py-2.5 focus:border-blue-700"
                  />
                  <span className="mt-1.5 block text-sm text-slate-600">{hint}</span>
                </label>
              ))}
            </div>
          </div>
        </fieldset>

        <fieldset className="rounded-lg border border-slate-300 bg-white p-6 shadow-sm">
          <legend className="px-2 text-lg font-semibold">
            Step 2 &middot; The label artwork
          </legend>
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={(event) => setImage(event.target.files?.[0] ?? null)}
            className="block w-full text-slate-700 file:mr-4 file:cursor-pointer file:rounded file:border-0 file:bg-blue-800 file:px-5 file:py-2.5 file:font-semibold file:text-white hover:file:bg-blue-900"
          />
          <p className="mt-2 text-sm text-slate-600">
            PNG, JPEG, GIF or WebP, up to 10 MB. Photographs taken at an angle or
            in poor light usually still work.
          </p>
          {previewUrl && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={previewUrl}
              alt="Preview of the uploaded label"
              className="mt-4 max-h-72 rounded border border-slate-300"
            />
          )}
        </fieldset>

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={!ready || checking}
            className="rounded bg-blue-800 px-8 py-3.5 text-lg font-semibold text-white hover:bg-blue-900 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {checking ? "Checking…" : "Check this label"}
          </button>
          {(result || error) && (
            <button
              type="button"
              onClick={reset}
              className="rounded border-2 border-slate-400 px-6 py-3 font-semibold hover:bg-slate-200"
            >
              Start over
            </button>
          )}
          {!ready && !checking && (
            <p className="text-slate-600">
              Fill in the four required boxes and choose an image.
            </p>
          )}
        </div>
      </form>

      <div aria-live="polite">
        {error && (
          <p className="rounded border-l-8 border-fail bg-fail-bg px-5 py-4 font-medium">
            {error}
          </p>
        )}
        {result && <ResultPanel result={result} />}
      </div>
    </div>
  );
}
