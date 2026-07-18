import type { ApplicationSubmission, VerificationResult } from "@/lib/types";

/**
 * Longest edge we send to the server, in pixels.
 *
 * A modern phone photo is ~4000px, which costs upload time and image tokens
 * without helping legibility. Measured round trip drops by roughly a second at
 * this size. Deliberately conservative rather than smaller: the warning
 * statement is the smallest print on the label, and shrinking it until it
 * misreads would turn a rejection into a false approval.
 */
const MAX_EDGE = 1600;

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
