/**
 * Type-size measurement for the Government Warning (FR-10, 27 CFR 16.22).
 *
 * This is a *measurement*, not an inference. It runs server-side on the
 * uploaded pixels with sharp, entirely outside the model call: nothing here
 * touches a prompt or an extraction schema, and the model is never asked how
 * big anything is. `docs/TYPE-SIZE-FEASIBILITY.md` records two model-based
 * attempts that failed at ±30-40% absolute error — wider than the 20% band the
 * decision has to resolve — and both looked stable while being wrong.
 *
 * The module makes NO compliance judgement. It returns either a measured cap
 * height with its uncertainty, or a refusal with a machine-readable reason.
 * Deciding what a millimetre figure means against the regulation is compare.ts's
 * job, in the same way every other verdict in this codebase is.
 *
 * Scope boundary (deliberate): flat, square-on artwork only. That is what most
 * COLA submissions are, since applicants file the printed artwork file rather
 * than a bottle photograph. Perspective could in principle be corrected by a
 * homography; cylindrical curvature on a real bottle cannot, and text near the
 * edge of a curved label compresses in ways that silently corrupt a
 * measurement. So anything that is not square-on is REFUSED. A refusal is a
 * correct answer. A confident measurement of a curved label is not.
 */

import sharp from "sharp";

/** Why a measurement was not made. Refusals never contribute to a verdict. */
export type TypeSizeRefusalReason =
  | "no-width-supplied"
  | "label-boundary-not-found"
  | "not-square-on"
  | "aspect-distorted"
  | "warning-text-not-located"
  | "image-unreadable";

export interface TypeSizeRefusal {
  measured: false;
  reason: TypeSizeRefusalReason;
  /** Plain English, safe to show an agent. */
  detail: string;
}

export interface TypeSizeMeasurement {
  measured: true;
  /** Cap height of the warning's leading capital, in image pixels. */
  capHeightPx: number;
  /** Detected printed width of the label, in image pixels. */
  labelWidthPx: number;
  /** Stated physical width divided by detected pixel width. */
  mmPerPx: number;
  /** Cap height in millimetres. Centre estimate. */
  capHeightMm: number;
  /**
   * Half-width of the uncertainty interval on capHeightMm, in millimetres.
   * See UNCERTAINTY below — this is a real error budget, not decoration.
   */
  uncertaintyMm: number;
}

export type TypeSizeResult = TypeSizeMeasurement | TypeSizeRefusal;

/**
 * Both thresholds are expressed as a *distance from the local background*,
 * never as an absolute luminance. The scratch pipeline used a fixed "darker
 * than 140" test and broke the moment it was swept below the printed rule's own
 * colour (#8a6a2f, luma ~108): the rules stopped registering as ink and the
 * band detector lost the reference lines it uses to find the warning block.
 * Deviation-from-background makes the detector indifferent to how dark any
 * particular ink happens to be, and does not assume dark-on-light artwork.
 *
 * Two separate values, because the two steps discriminate against different
 * surfaces and a single number cannot serve both:
 *
 *  - BOUNDARY_TOLERANCE separates the label from the surface it sits on. It has
 *    to be loose: a label's outer border stroke can be much closer to the
 *    backdrop than its body text is to its own paper (on the fixtures, 65
 *    levels from the backdrop against 215 for the text). Tightening this
 *    silently crops the border off the detected label, shrinking the measured
 *    pixel width and inflating every millimetre figure derived from it.
 *  - INK_TOLERANCE separates type from the paper it is printed on, and wants to
 *    sit near the midpoint of that contrast so the measured row extent lands on
 *    the glyph's geometric edge rather than out in its antialiasing. Swept over
 *    40-130 on the fixtures the cap height moves by at most one pixel, and 100
 *    is where the residual against computed ground truth is smallest and
 *    one-sided-smallest: +0.8px, +0.5px, +0.3px on caps of nominal 8.2, 16.5 and
 *    5.7px. Above ~120 the printed rules stop registering and band detection
 *    degrades, so 100 also keeps a comfortable margin from that cliff.
 */
const BOUNDARY_TOLERANCE = 40;
const INK_TOLERANCE = 100;

/**
 * Minimum fraction of its own bounding box the label must fill.
 *
 * A square-on rectangle fills its axis-aligned bounding box exactly; rotate it
 * and the box gains two triangular wedges. Measured on samples/compliant-
 * warning.png rotated in place:
 *
 *     0.00°  1.00000      2°  0.93153
 *     0.25°  0.98947      3°  0.90138
 *     0.50°  0.98249      7°  0.79841  (samples/stones-throw-tilted.png)
 *     1.00°  0.96591
 *
 * Square-on artwork scores exactly 1.0, so 0.995 sits between "no rotation at
 * all" and a quarter of a degree — it refuses essentially any tilt while
 * leaving headroom for antialiasing along the boundary. That is strict on
 * purpose. A quarter degree is only ~0.2% on cap height and would be harmless,
 * but the same statistic is the only thing standing between this module and a
 * curved bottle photograph, where the error is unbounded and invisible. The
 * cost of being strict is a refusal, which asserts nothing; the cost of being
 * lax is a confident wrong number. It also catches perspective and curvature
 * for free, since neither produces an exactly-rectangular silhouette.
 *
 * IMPORTANT LIMIT, found by adversarial review rather than by design: this
 * statistic is scale-invariant, so it does NOT catch anisotropic distortion. An
 * image stretched on one axis stays perfectly rectangular and scores 1.0 while
 * every vertical measurement taken from it is wrong. Measured: a fixture
 * stretched to 800x1400 read 3.88mm against a 2.74mm truth (+41%), and stretching
 * a genuinely undersized label walked its verdict from FAIL to REVIEW to PASS.
 * The error is biased upward, i.e. toward false approval, which is the direction
 * the band design is specifically meant to avoid.
 *
 * The aspect check below is the mitigation. It needs the caller to supply the
 * label's height as well as its width; with width alone, anisotropic distortion
 * remains undetectable and is disclosed as a known limitation.
 */
const MIN_RECTANGULARITY = 0.995;

/**
 * Smallest cap height we will measure from, in pixels.
 *
 * The spike recommended 8px, reasoning that below it the fixed +-1px
 * quantisation exceeds 12.5% of the reading and eats the REVIEW band. That
 * reasoning is right about precision and wrong about this decision: the
 * fixture representing the actual abuse case — a warning buried in tiny type —
 * has a 6px cap, so an 8px floor refuses to measure precisely the labels the
 * check exists to catch, and reports "not assessed" instead of a violation.
 *
 * Relative uncertainty is the wrong test. What matters is whether the
 * uncertainty could change the verdict, and that is already handled: the
 * measurement carries its +-1px interval into compare.ts, which returns REVIEW
 * whenever the interval straddles the threshold. A 6px cap reads 0.98mm +-0.16mm
 * against a 2mm minimum — imprecise, and unambiguously non-compliant.
 *
 * So this floor is only about glyph *detectability*, not precision: below about
 * 4px there is no letter to measure, just antialiasing noise.
 */
const MIN_CAP_HEIGHT_PX = 4;

/**
 * How far the label's detected pixel aspect ratio may differ from the aspect
 * the caller states before we treat the image as anisotropically distorted.
 *
 * 4% absorbs boundary antialiasing and ordinary rounding while still catching
 * the distortion that matters: the measured +41% error case corresponded to a
 * 75% aspect discrepancy, so this fires long before the reading goes wrong.
 */
const MAX_ASPECT_DEVIATION = 0.04;

/**
 * Uncertainty budget, in relative terms, applied to the millimetre figure.
 *
 * Three independent contributions:
 *
 *  1. Cap-height quantisation. The row extent is an integer count of ink rows,
 *     and antialiasing puts the true geometric cap within about a pixel of it.
 *     Measured against computed ground truth on the fixtures the residual was
 *     1px (11.1% on a 9px glyph). This is the dominant term and it shrinks as
 *     the glyph gets larger, so it is carried as +-1px rather than a percentage.
 *  2. Label boundary. The detected printed extent can differ from the nominal
 *     artwork box by the width of the border stroke and its antialiasing —
 *     ~1% on a 620px label.
 *  3. Rasterisation bias. Ink rows can exceed the geometric cap height by up to
 *     a pixel; already covered by (1)'s +-1px, so no separate term.
 *
 * Combined at a threshold-sized glyph (~12px cap at 2mm on a 100mm label):
 * 1/12 + 0.01 ~ 9.3%. The PASS/FAIL bands below are set at +-20%, which is
 * roughly twice that — deliberately conservative, because the failure mode
 * being guarded against is a wrong rejection, and a REVIEW costs an agent a
 * glance while a wrong FAIL costs an applicant a resubmission.
 */
const CAP_QUANTISATION_PX = 1;
const BOUNDARY_RELATIVE_ERROR = 0.01;

interface Grey {
  data: Buffer;
  width: number;
  height: number;
}

/** Median grey level of the image's border ring — the surface the label sits on. */
function backgroundLevel(g: Grey): number {
  const samples: number[] = [];
  for (let x = 0; x < g.width; x += 3) {
    samples.push(g.data[x]);
    samples.push(g.data[(g.height - 1) * g.width + x]);
  }
  for (let y = 0; y < g.height; y += 3) {
    samples.push(g.data[y * g.width]);
    samples.push(g.data[y * g.width + g.width - 1]);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

/**
 * A solid silhouette of everything that is not background.
 *
 * The per-row hole fill is the point of this function. A raw threshold mask of a
 * printed label is mostly holes — the cream field between the glyphs is the same
 * colour as the surrounding paper. Filling each row from its first to its last
 * masked pixel turns that lace into the solid rectangle the label physically is,
 * which makes the rectangularity test below a test of *shape* rather than of how
 * much ink the artwork happens to carry. Without it a sparse label and a busy
 * one would score completely differently on an identical geometry.
 */
function silhouette(g: Grey): Uint8Array {
  const bg = backgroundLevel(g);
  const mask = new Uint8Array(g.width * g.height);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = Math.abs(g.data[i] - bg) > BOUNDARY_TOLERANCE ? 1 : 0;
  }
  for (let y = 0; y < g.height; y++) {
    const row = y * g.width;
    let first = -1;
    let last = -1;
    for (let x = 0; x < g.width; x++) {
      if (mask[row + x]) {
        if (first < 0) first = x;
        last = x;
      }
    }
    for (let x = first; x >= 0 && x <= last; x++) mask[row + x] = 1;
  }
  return mask;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
  height: number;
  area: number;
}

function boundingBox(mask: Uint8Array, width: number, height: number): Box | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  let area = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x0, y0, x1, y1, width: x1 - x0 + 1, height: y1 - y0 + 1, area };
}

interface Band {
  y0: number;
  y1: number;
  height: number;
  maxInk: number;
}

/** Horizontal runs of rows carrying ink — one per line of text, one per rule. */
function inkBands(g: Grey, bg: number, box: Box): Band[] {
  const counts: number[] = [];
  for (let y = box.y0; y <= box.y1; y++) {
    let ink = 0;
    for (let x = box.x0; x <= box.x1; x++) {
      if (Math.abs(g.data[y * g.width + x] - bg) > INK_TOLERANCE) ink++;
    }
    counts.push(ink);
  }

  const bands: Band[] = [];
  let start: number | null = null;
  for (let i = 0; i < counts.length; i++) {
    // Two pixels, not one: a single stray pixel from JPEG ringing should not
    // open a band, but the thinnest real glyph stroke spans at least two.
    if (counts[i] >= 2) {
      if (start === null) start = i;
    } else if (start !== null) {
      bands.push({
        y0: box.y0 + start,
        y1: box.y0 + i - 1,
        height: i - start,
        maxInk: Math.max(...counts.slice(start, i)),
      });
      start = null;
    }
  }
  if (start !== null) {
    bands.push({
      y0: box.y0 + start,
      y1: box.y1,
      height: counts.length - start,
      maxInk: Math.max(...counts.slice(start)),
    });
  }
  return bands;
}

/** Thin and nearly full width: a printed rule, not a line of type. */
function isRule(band: Band, boxWidth: number): boolean {
  return band.height <= 4 && band.maxInk > boxWidth * 0.8;
}

/**
 * Widest cap height we will believe, as a fraction of the label height.
 * The warning is the smallest print on a label; anything taller than this is a
 * brand name or a decorative glyph and means the block was misidentified.
 */
const MAX_PLAUSIBLE_CAP_FRACTION = 0.06;

/**
 * Measure the Government Warning's cap height, in millimetres.
 *
 * @param image        the uploaded artwork, any format sharp can decode
 * @param labelWidthMm the applicant's stated physical width of the printed
 *                     label. Undefined means "not assessed" — never guessed.
 */
export async function measureWarningTypeSize(
  image: Buffer,
  labelWidthMm: number | undefined,
  /**
   * Optional. Supplying it enables the anisotropic-distortion check — without a
   * stated height there is nothing to compare the detected aspect ratio against,
   * and a stretched image is measured as though it were undistorted.
   */
  labelHeightMm?: number | undefined,
): Promise<TypeSizeResult> {
  if (labelWidthMm === undefined || !Number.isFinite(labelWidthMm) || labelWidthMm <= 0) {
    return {
      measured: false,
      reason: "no-width-supplied",
      detail:
        "No physical label width was supplied, so pixels cannot be converted to millimetres.",
    };
  }

  let g: Grey;
  try {
    const { data, info } = await sharp(image)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    g = { data, width: info.width, height: info.height };
  } catch {
    return {
      measured: false,
      reason: "image-unreadable",
      detail: "This image could not be decoded for measurement.",
    };
  }

  const mask = silhouette(g);
  const box = boundingBox(mask, g.width, g.height);
  if (!box || box.width < 32 || box.height < 32) {
    return {
      measured: false,
      reason: "label-boundary-not-found",
      detail:
        "The edge of the printed label could not be separated from its background, so there is no scale to measure against.",
    };
  }

  const rectangularity = box.area / (box.width * box.height);
  if (rectangularity < MIN_RECTANGULARITY) {
    return {
      measured: false,
      reason: "not-square-on",
      detail:
        "The label is rotated, angled or curved in this image. Type size is only measured on flat, square-on artwork, because distortion changes apparent letter height without changing the label's width.",
    };
  }

  // Rectangularity is scale-invariant, so a stretched image passes the test
  // above while every vertical reading taken from it is inflated. Scale comes
  // from the width, so a vertical stretch biases the measurement UPWARD — it
  // makes an undersized warning look compliant, the one direction this tool
  // must not fail in. Comparing the detected aspect against the stated one is
  // the only way to see it, and it needs a stated height.
  if (labelHeightMm !== undefined && Number.isFinite(labelHeightMm) && labelHeightMm > 0) {
    const statedAspect = labelWidthMm / labelHeightMm;
    const detectedAspect = box.width / box.height;
    const deviation = Math.abs(detectedAspect - statedAspect) / statedAspect;
    if (deviation > MAX_ASPECT_DEVIATION) {
      return {
        measured: false,
        reason: "aspect-distorted",
        detail:
          `The label measures ${detectedAspect.toFixed(2)}:1 in this image but the stated dimensions are ${statedAspect.toFixed(2)}:1, so the image has been stretched or squashed. Letter heights read from it would be wrong.`,
      };
    }
  }

  // Step in off the boundary so the border stroke itself is not read as a line
  // of type. 6px is comfortably wider than the printed border on the fixtures
  // and negligible against a label hundreds of pixels wide.
  const inset = 6;
  const inner: Box = {
    x0: box.x0 + inset,
    y0: box.y0 + inset,
    x1: box.x1 - inset,
    y1: box.y1 - inset,
    width: box.width - 2 * inset,
    height: box.height - 2 * inset,
    area: 0,
  };

  // The background *inside* the label (the paper/field colour), which is not
  // the same surface the border ring sampled.
  const fieldLevel = interiorLevel(g, inner);

  const bands = inkBands(g, fieldLevel, inner).filter((b) => !isRule(b, inner.width));
  if (bands.length === 0) {
    return {
      measured: false,
      reason: "warning-text-not-located",
      detail: "No lines of text could be isolated on this label.",
    };
  }

  // The Government Warning is a block of small, tightly-leaded lines at the
  // bottom of the label — the last such run. Walk up from the last band while
  // the lines stay small and closely spaced; the first big or well-separated
  // band above it is the body copy the warning sits under.
  const MAX_WARNING_LINE_HEIGHT = Math.max(6, Math.round(inner.height * 0.03));
  const MAX_WARNING_LEADING = MAX_WARNING_LINE_HEIGHT;
  let first = bands.length - 1;
  while (
    first > 0 &&
    bands[first - 1].height <= MAX_WARNING_LINE_HEIGHT &&
    bands[first].y0 - bands[first - 1].y1 <= MAX_WARNING_LEADING
  ) {
    first--;
  }
  const line = bands[first];

  // Within the warning's first line, isolate the leading glyph by column
  // profile — the "G" of GOVERNMENT. Measuring the whole line's row extent
  // would pick up descenders and any punctuation, giving ascender-to-descender
  // extent rather than cap height, which is the quantity 16.22 is written in.
  let gx0 = -1;
  let gx1 = -1;
  for (let x = inner.x0; x <= inner.x1; x++) {
    let ink = 0;
    for (let y = line.y0; y <= line.y1; y++) {
      if (Math.abs(g.data[y * g.width + x] - fieldLevel) > INK_TOLERANCE) ink++;
    }
    if (ink > 0) {
      if (gx0 < 0) gx0 = x;
      gx1 = x;
    } else if (gx0 >= 0) {
      break; // first inter-letter gap: we have exactly one glyph
    }
  }
  if (gx0 < 0) {
    return {
      measured: false,
      reason: "warning-text-not-located",
      detail: "The first letter of the warning block could not be isolated.",
    };
  }

  let ry0 = -1;
  let ry1 = -1;
  for (let y = line.y0; y <= line.y1; y++) {
    for (let x = gx0; x <= gx1; x++) {
      if (Math.abs(g.data[y * g.width + x] - fieldLevel) > INK_TOLERANCE) {
        if (ry0 < 0) ry0 = y;
        ry1 = y;
        break;
      }
    }
  }
  const capHeightPx = ry1 - ry0 + 1;
  // The spike measured +-1px quantisation regardless of glyph size, so below
  // ~8px that single pixel exceeds 12.5% and starts consuming the REVIEW band
  // the verdict relies on. Refusing is honest; measuring is not. Observed +18%
  // error at 7px, against a reported uncertainty that did not cover it.
  if (capHeightPx < MIN_CAP_HEIGHT_PX || capHeightPx > box.height * MAX_PLAUSIBLE_CAP_FRACTION) {
    return {
      measured: false,
      reason: "warning-text-not-located",
      detail:
        "The block identified as the Government Warning is not the right shape for warning type, so no measurement is reported.",
    };
  }

  // Scale comes from the *detected label*, never from the image width. That
  // distinction is the whole fix for the arithmetic bug that sank PRP-21: on
  // these fixtures the label occupies 620px of an 800px image, and dividing by
  // 800 under-reads every measurement by a factor of 0.775 — enough on its own
  // to fail a compliant label, before any other error source.
  //
  // `box.width` is the outermost printed extent, border stroke included. That is
  // a deliberate choice rather than an accident of the threshold: the applicant
  // is asked for the width of the printed label, and a printed border is part of
  // the printed label. Measuring to the inside of the border instead would
  // read ~1% narrower here and inflate every millimetre figure by the same 1% —
  // which is why BOUNDARY_RELATIVE_ERROR carries a 1% term.
  const mmPerPx = labelWidthMm / box.width;
  const capHeightMm = capHeightPx * mmPerPx;
  const uncertaintyMm =
    CAP_QUANTISATION_PX * mmPerPx + capHeightMm * BOUNDARY_RELATIVE_ERROR;

  return {
    measured: true,
    capHeightPx,
    labelWidthPx: box.width,
    mmPerPx,
    capHeightMm,
    uncertaintyMm,
  };
}

/** Median grey level inside the label — its paper/field colour. */
function interiorLevel(g: Grey, inner: Box): number {
  const samples: number[] = [];
  const stepX = Math.max(1, Math.floor(inner.width / 64));
  const stepY = Math.max(1, Math.floor(inner.height / 64));
  for (let y = inner.y0; y <= inner.y1; y += stepY) {
    for (let x = inner.x0; x <= inner.x1; x += stepX) {
      samples.push(g.data[y * g.width + x]);
    }
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}
