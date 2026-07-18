# Type-size measurement: feasibility study

**Requirement:** FR-10 — verify the Government Warning meets the minimum type
size in 27 CFR 16.22 (≤237 mL: 1 mm · 237 mL–3 L: 2 mm · >3 L: 3 mm).

**Result: not implementable to a standard that could justify a rejection.**
FR-10 stays out of scope. This document records why, so the conclusion can be
challenged rather than taken on faith.

---

## The problem

The regulation is written in millimetres. A photograph has no inherent scale, so
millimetres cannot be derived from pixels without an external reference. The
proposed approach was:

1. Ask the model for the warning text's bounding box in pixels
2. Have the applicant supply a physical dimension (label width in mm)
3. Derive mm-per-pixel, convert the measured cap height, compare to the threshold

Two independent error sources killed it.

## Error 1 — the model's boxes are precise but not accurate

Ground truth was established by decoding `samples/old-tom.png` directly and
profiling ink rows, not by asking the model. The capital "G" of GOVERNMENT
occupies y830–838: **cap height 9 px**.

Three runs with a purely perceptual prompt:

| Run | Reported cap height | True | Error |
|---|---|---|---|
| 1 | 11 px | 9 px | +22% |
| 2 | 11 px | 9 px | +22% |
| 3 | 11 px | 9 px | +22% |

Line count (3) and left edge (x=128) were correct every time. The vertical
extent was not.

**The stability is the trap.** Zero run-to-run variance looks like a reliable
instrument. It is not — it is a consistent prior. Re-running never surfaces the
error; only external ground truth does. A team that validated this by checking
reproducibility would have concluded it worked.

A fourth diagnostic cropped the warning band and upscaled 2×, giving the model a
well-resolved 18 px glyph. Accuracy improved but the **error changed sign**:
−12% on the crop against +22% on the full label. A bias whose direction depends
on input resolution cannot be calibrated out.

## Error 2 — the scale formula was wrong

Independently of the model: deriving mm-per-pixel from the supplied label width
and the **image** width assumes the label fills the frame. On `old-tom.png` the
printed label occupies 620 px of an 800 px image; the rest is background.

That under-reads every measurement by a factor of 0.775. A compliant 2.2 mm cap
height measures as 1.7 mm and is flagged — **a false rejection produced by
arithmetic alone**, before any model error.

On this particular fixture the two errors partially cancel (0.775 × 1.25 ≈
0.97). That is luck, not design, and does not hold for labels photographed with
different margins.

## Why that is disqualifying

Combined error budget: roughly ±30–40%. The decision has to resolve a 20% review
band around a 2 mm threshold.

**The instrument is wider than the band it has to measure.**

Under honest handling, nearly every label lands in "needs review" — friction with
no information. The cases that escape into a confident verdict are precisely
those where the two uncontrolled errors compounded rather than cancelled, which
is the wrong-rejection outcome the design forbids.

## What would make it viable

- A scale reference in the frame (a ruler, or a known-dimension fiducial)
- Or the physical label dimensions **and** a guarantee the label fills a known
  region of the frame
- Or a classical CV measurement — edge detection on the label boundary plus
  connected-component analysis on glyphs — which is deterministic and testable
  against ground truth, unlike a model's visual estimate

None is a small change, and each needs validation against real artwork before
any verdict depends on it.

## Method

4 API calls. Ground truth by direct pixel decoding. Scripts were written to a
scratchpad and no repository file was modified during the study.
