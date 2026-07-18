import type { ApplicationSubmission, VerificationResult } from "@/lib/types";

/**
 * Longest edge we send to the server, in pixels.
 *
 * A modern phone photo is ~4000px, which costs upload time and image tokens
 * without helping legibility. Was 1600; lowered to 1200 on measured evidence.
 *
 * Sweep at 1600/1200/900/700px long edge, both `old-tom` and `unbolded-warning`
 * rendered at 2400x3000 and downscaled with `sips -Z`, 3 direct API calls each
 * (same model, params and prompt as lib/providers/anthropic.ts, no Next.js):
 *
 *   1600px  4570 input tok  median 4652ms
 *   1200px  3407 input tok  median 4256ms
 *    900px  2760 input tok  median 4186ms  (4 of 6 timings captured)
 *    700px  2402 input tok  warm median 4130ms, 2 of 5 warm calls over 5000ms
 *
 * Every size transcribed the government warning byte-exact against
 * GOVERNMENT_WARNING on 6/6 runs, and `headingBold` was correct on 6/6 at every
 * size (true for old-tom, false for unbolded-warning, never null). Bold
 * detection did not degrade anywhere in the sweep, so the binding constraint is
 * margin for real photographs, not measured accuracy.
 *
 * 1200 rather than 900 or 700 deliberately. 900 was the smallest size with a
 * clean sweep and only ~650 tokens cheaper than 1200; 700 showed a worse
 * latency tail and was never run against samples/title-case-warning.png, the
 * fixture that probes capitalization fidelity in the warning itself. The
 * fixtures are clean synthetic renders — a phone photo of a curved bottle under
 * shop lighting is strictly harder, and the warning statement is the smallest
 * print on the label. Keeping 1.33x linear headroom over the smallest passing
 * size buys that margin for ~25% of the input tokens 1600 was spending.
 *
 * This does not fix NFR-1: the 5s tail is dominated by cold connections and
 * model queueing, not image size. It cuts cost on real uploads and shaves the
 * median. See README "Measured latency".
 */
const MAX_EDGE = 1200;

/** Downscale oversized uploads in the browser. Small images pass through untouched. */
async function downscale(image: File): Promise<Blob> {
  if (typeof createImageBitmap !== "function") return image;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(image);
  } catch {
    return image; // Unsupported codec — let the server validate and report.
  }

  const longestEdge = Math.max(bitmap.width, bitmap.height);
  if (longestEdge <= MAX_EDGE) {
    bitmap.close();
    return image;
  }

  const scale = MAX_EDGE / longestEdge;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return image;
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.92),
  );
  return blob ?? image;
}

/** POSTs one label + application pair and returns the verdict. */
export async function verifyLabel(
  image: File,
  application: ApplicationSubmission,
): Promise<VerificationResult> {
  const prepared = await downscale(image);
  const form = new FormData();
  form.append(
    "image",
    prepared,
    prepared === (image as Blob) ? image.name : `${image.name}.jpg`,
  );
  form.append("brandName", application.brandName);
  form.append("classType", application.classType);
  form.append("alcoholContent", application.alcoholContent);
  form.append("netContents", application.netContents);
  // Omitted entirely when the applicant did not state one — sending an empty
  // field would be indistinguishable from claiming a blank value.
  if (application.bottlerAddress?.trim()) {
    form.append("bottlerAddress", application.bottlerAddress.trim());
  }
  if (application.countryOfOrigin?.trim()) {
    form.append("countryOfOrigin", application.countryOfOrigin.trim());
  }
  // Millimetres survive the downscale above untouched, because the server
  // derives its scale from the *detected label width in the image it receives*,
  // not from any assumed resolution — shrink both and mm-per-pixel is
  // unchanged. What downscaling does cost is precision: cap height is an
  // integer pixel count, so a smaller image spends more of the error budget on
  // quantisation. At MAX_EDGE=1200 a warning still lands around 10px, the same
  // order as the fixtures this was validated against.
  if (application.labelWidthMm?.trim()) {
    form.append("labelWidthMm", application.labelWidthMm.trim());
  }

  const response = await fetch("/api/verify", { method: "POST", body: form });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error ?? "The server could not check this label.");
  }
  return payload as VerificationResult;
}

/**
 * Runs `worker` over every item with a fixed number of requests in flight.
 * Importers drop 200-300 applications at once; firing them all at once would
 * hit rate limits and give agents no feedback until the very end.
 */
export async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}
