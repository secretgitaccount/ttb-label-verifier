import { NextResponse } from "next/server";
import { getObservabilitySummary } from "@/lib/observability";

export const runtime = "nodejs";

/**
 * A running aggregate of what the model calls have cost and how long they took.
 *
 * Check a few labels, then open this in a browser. It is intentionally ungated
 * for a prototype — it exposes counts, token totals, latency percentiles and
 * dollars, no request content and no secrets. The `note` field states the
 * in-memory caveat rather than hiding it.
 */
export async function GET() {
  return NextResponse.json(getObservabilitySummary());
}
