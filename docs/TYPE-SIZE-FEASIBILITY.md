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

---

# Second study: relative measurement

The study above rejected absolute millimetre measurement but left an opening — if
the model's vertical bias were a stable multiplicative factor, it would **cancel
in a ratio**. Measure the warning's cap height against another piece of text on
the same label, and no physical scale is needed at all.

That reframing also changes the goal: not "does this comply with 16.22" (written
in millimetres) but "is this warning conspicuously smaller than the rest of the
label" — the abuse actually described in the interviews.

**Result: the hypothesis is false. The ratio is worse than either input.**

## Measurement

Ground truth by direct pixel decoding of `samples/old-tom.png`, profiling ink
rows to isolate glyphs, with the ink threshold swept from 60 to 200 to bound
uncertainty. Cross-checked against the CSS: Helvetica cap-height ratio ≈0.717 ×
11.5px ≈ 8.2; Georgia ≈0.692 × 25px ≈ 17.3 — consistent with the decoded pixels,
confirming cap height was measured rather than ascender extent.

| Quantity | Model | Ground truth | Error |
|---|---|---|---|
| Warning cap height ("G" of GOVERNMENT) | 8 px | 9 px | −11.1% |
| Reference cap height ("K" of Kentucky) | 22 px | 18 px | +22.2% |
| **Ratio** | **≈0.36** | **0.500** | **−27.3%** |

Identical on all three runs. Zero variance, again.

## Why it fails

The hypothesis required a **common** multiplicative bias. The errors are instead
**anti-correlated** — one under-reads, the other over-reads — so they compound
rather than cancel. The ratio error (−27.3%) exceeds both input errors.

At that magnitude the instrument cannot separate a compliant label from the
abuse case. A warning set at half the class-type height reads as roughly a
third, which would flag `old-tom` — a compliant fixture — as suspicious. The
detector's false alarms would land on exactly the labels that are fine.

Even the most charitable ground truth (opposite ends of both threshold bands,
which is not a defensible reading of the pixels) leaves −13.6% error. The centre
estimate is −27%. The bar was under 15% and stable.

## The finding that closes the question

The first study measured a +22% over-read and called it stable. Here the same
+22% appeared on the class/type text but **not** on the warning, where an
explicit cap-height prompt produced an under-read instead.

**The bias is not a property of the model's vertical perception.** It varies with
glyph size and with how the question is asked. So it cannot be calibrated out —
not by a constant, and not by a ratio, because there is no consistent factor to
cancel.

## Standing conclusion

Two independent approaches, two negative results, one requirement. FR-10 stays
out of scope.

What the model does well here is transcription and gross perceptual distinctions
— *is this heading heavier than the body text* is answered reliably enough to
carry a compliance check (FR-7). Fine-grained metric estimation is a different
capability, and it is not present. Anything depending on it needs a classical CV
measurement validated against ground truth, not a visual estimate.

Note also that both studies were only possible because ground truth was
computable — the fixtures are rendered from HTML at known font sizes. On real
photographed artwork there would have been nothing to check the model against,
and the zero run-to-run variance would have looked like precision.
