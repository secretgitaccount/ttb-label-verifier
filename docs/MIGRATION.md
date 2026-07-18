# Migration path: running without `api.anthropic.com`

**Status: unsolved.** This document does not describe work that has been done.
It describes a known blocker, what the code already does to contain it, and
what each way out would actually cost.

**One thing has since changed:** the swap seam is now real code rather than a
description. `lib/extract.ts` selects a provider from `lib/providers/` by env
var, and an Azure adapter exists at `lib/providers/azure.ts`. See §2.1.

**That adapter has never run.** It is code-complete, type-checked, and
unverified — there is no Azure account and no network access to one. It has
never been executed against the service. Nothing below should be read as
"Azure works now". It does not reduce the probability of the blocker in §1,
and it is not benchmarked.

> ### ⚠ The Azure path loses bold detection (FR-7). Read §2.2.
> Every label checked through the Azure adapter returns `headingBold: null`
> and therefore needs a human to check the heading weight. This is a genuine
> capability loss, not a footnote.

---

## 1. The risk

Every label check in this application makes one outbound HTTPS call to
`api.anthropic.com`. There is no cache, no fallback, and no offline mode. If
that host is unreachable, the app does not degrade — it returns an error for
every request, and the compliance engine never runs.

Marcus Williams (IT) stated two things in his interview:

- TTB's network blocks outbound traffic to many domains.
- The previous vendor's ML endpoints were firewall-blocked.

This application has the same shape as that vendor's: a hosted third-party ML
endpoint, called synchronously, on the request path. **Behind TTB's firewall it
fails the same way, for the same reason.** The architecture below reduces the
cost of fixing that. It does not reduce the probability of it happening.

Two further points that should not be soft-pedalled:

- This is a network and procurement problem, not a code problem. No
  application-level change makes a blocked connection succeed. A firewall
  allowlist entry for the endpoint requires a security review that this
  prototype has not been through and cannot speed up.
- Even a successful allowlist request leaves label artwork — regulated
  submission material — transiting to a third-party API. That is a data
  governance decision above the engineering layer, and it is a plausible reason
  for the answer to be no even when the network could technically permit it.

Assume for planning purposes that the model must move inside TTB's boundary.

---

## 2. Why the swap is contained

The load-bearing design decision (PRD NFR-5/NFR-6) is that **the model only
transcribes; TypeScript decides.**

`lib/extract.ts` is the only module that touches a model, and its entire
contract with the rest of the system is one function:

```ts
extractLabel(imageBase64: string, mediaType: SupportedMediaType): Promise<ExtractedLabel>
```

`ExtractedLabel` (`lib/types.ts`) is a flat transcription record: the four
application fields as printed, the two optional TTB fields, the government
warning (`present`, verbatim `text`, `headingAllCaps`, `headingBold`), and an
`imageQuality` block. It contains no verdict, no severity, no rule reference —
nothing a regulator would need to audit.

Every compliance judgement lives downstream in `lib/compare.ts` and
`lib/warning.ts`: the normalisation ladder, the 27 CFR 5.65 ABV
tolerance, millilitre conversion, the exact-match check against the 27 CFR
16.21 text, the three-state verdict and its roll-up. None of it knows or can
know which model produced the transcription.

The practical consequence: **anything that can populate `ExtractedLabel` from
an image is a drop-in replacement.** `compare.ts`, `warning.ts`, `csv.ts`, the
API route's verification logic and the UI are unaffected. So is the entire
`test/compare.test.ts` suite, which constructs `ExtractedLabel` literals
directly and never opens a socket — it keeps passing across a model swap
without edits. That is what makes the migration estimable rather than
open-ended.

(`test/extract.test.ts` is the exception: it tests the transcription boundary
itself, so a swap does touch it. It exercises `validateExtractedLabel`, which
is backend-agnostic, so most of it should survive — but budget for revisiting
it rather than assuming it is free.)

## 2.1 The seam, as it now exists in code

```
lib/extract.ts              selects a provider; exports extractLabel
lib/providers/contract.ts   LabelExtractor type + validateExtractedLabel (backend-agnostic)
lib/providers/anthropic.ts  the working implementation, moved here unchanged
lib/providers/azure.ts      UNVERIFIED adapter — never executed
```

Selection is by `EXTRACTION_PROVIDER`, defaulting to `anthropic`. An unknown
value throws at call time listing the valid names, rather than silently falling
back to the default — a typo that quietly kept calling `api.anthropic.com`
would defeat the point of the exercise.

The Azure adapter is written against the **documented REST surface using
`fetch`**, not the `@azure-rest/ai-document-intelligence` SDK. That is
deliberate: the SDK's exact method names are not known here with confidence,
and guessing them while presenting them as fact would be worse than saying so.
It also keeps the default path free of any new runtime dependency. The specific
inferences — route shape, `api-version`, the `base64Source` body key, the
202 + `Operation-Location` polling envelope, `Ocp-Apim-Subscription-Key` auth,
and the `polygon` array shape — are enumerated in the adapter's header comment
and must be checked against current Azure docs before use. Entra ID / managed
identity auth, which TTB would most likely require, is **not** implemented.

What is tested: the pure `mapReadResultToLabel` OCR-lines → `ExtractedLabel`
mapping, in `test/providers.test.ts`, against synthetic OCR input. What is not
tested: every line that touches HTTP.

Field mapping is the largest work item and the weakest part. OCR returns an
unordered bag of lines, so the adapter identifies fields by pattern (ABV, net
contents, origin and bottler statements), picks the brand as the physically
largest unclaimed line, and falls back to a keyword list for class/type that
covers the distilled-spirits reference case and little else. The vision model
does this from context for free. Per NFR-5 this mapping lives in the adapter,
not in `compare.ts`: it decides which line a value was *read from*, never
whether a value is correct.

## 2.2 ⚠ REGRESSION: the Azure path cannot check bold (FR-7)

**`lib/providers/azure.ts` returns `headingBold: null` unconditionally.**

OCR reports text and geometry. It does not reliably report stroke weight
relative to adjacent body text, so there is nothing honest to populate the
field with.

`null` is the *safe* answer — `compare.ts` routes it through the existing
uncertainty path to REVIEW, never PASS, so a light-type heading is not silently
approved. But the cost is real and it is not small:

- **Every single label** checked through this provider comes back REVIEW on the
  government warning, regardless of the label's actual quality.
- FR-7 was the highest-severity requirement in the PRD precisely because a
  correctly capitalised heading in light type is a **false approval**. Under
  this provider that check is not performed — it is handed back to the agent.
- The product's case is throughput. A provider that returns "a human must look
  at this" for 100% of labels erodes a large part of that case. Anyone costing
  this migration should count agent hours, not just engineer-days.

Leads that were **not** implemented or validated: Azure's font/style add-on
(`features=styleFont`) is documented to return `analyzeResult.styles[]` with
`fontWeight: "normal" | "bold"` over character spans, which *might* populate
this field — its availability for the chosen model/version/locale, its accuracy
on label artwork, and its latency cost were all unverified here. Otherwise:
rebuild bold detection from glyph geometry, or formally downgrade FR-7.

A test in `test/providers.test.ts` asserts the `null`, so a future change
claiming to fix this has to overturn it deliberately.

### Honest caveat: `extract.ts` is not quite the whole surface

Two provider-specific details leak outside it, and a migration must handle
them:

- `app/api/verify/route.ts` imports `Anthropic` to branch on
  `Anthropic.APIError` in `describeFailure()`, and checks
  `process.env.ANTHROPIC_API_KEY` before accepting a request. Both need
  rewriting for a new backend — roughly 40 lines, mechanical, but real.
  **Concretely: setting `EXTRACTION_PROVIDER=azure` today is not sufficient to
  run without Anthropic.** The route still refuses every request with a
  500 unless `ANTHROPIC_API_KEY` is set, even though the key would then go
  unused, and Azure's HTTP failures would not map to the friendly messages in
  `describeFailure()` (the adapter throws pre-worded Errors to compensate,
  which the route's final `instanceof Error` branch passes through). That gate
  was left in place rather than edited because `route.ts` is outside the scope
  of this change; it is the first thing to fix if the Azure path is ever
  pursued.
- The call in `extract.ts` uses provider-specific request fields
  (`output_config.format.type: "json_schema"`, `effort`, `thinking`) and
  base64 image blocks. A replacement gets structured output some other way —
  a constrained decoder, a grammar, or post-hoc parsing and validation. The
  boundary validator (`validateExtractedLabel` in `extract.ts`) is already in
  place and is backend-agnostic, so a new backend inherits it for free. That
  matters more after a swap than before one: an open-weights model's JSON is
  less reliably schema-shaped than the current provider's, and the validator is
  what stops a malformed transcription from reaching `compare.ts`.

Call it 1–2 engineer-days to rewire the seam for any given backend. The cost
that matters is not the rewiring — it is the accuracy re-validation in §4.

---

## 3. The options

### 3a. Azure AI Document Intelligence / Azure AI Vision — strongest path

**Why it is first:** TTB migrated to Azure in 2019 and has cleared FedRAMP for
it. A service already inside their accredited cloud is a far easier approval
than a new third-party ML endpoint, and that approval — not accuracy — is the
binding constraint. Marcus described TTB as an Azure shop; this is the option
that matches the shop.

**What it gives:** managed OCR with layout analysis, no GPU hardware to buy or
maintain, and a per-page cost that is trivial against 150,000 applications a
year.

**What it costs, honestly:**
- It is still a network call, just to a host inside a boundary TTB already
  trusts. Someone still has to confirm the endpoint is reachable from the app's
  network segment. Do not assume "Azure" means "reachable".
- Document Intelligence returns text and layout, not the semantic fields this
  app needs. Mapping OCR output onto `brandName` / `classType` /
  `alcoholContent` / `netContents` means writing field-identification logic
  that the current vision model does for free — and that logic must live in a
  transcription-mapping layer, not in `compare.ts`, or the NFR-5 invariant
  breaks. That is the largest single work item in this option.
- `headingBold` (FR-7) is the hard part, and §2.2 is what the adapter actually
  does about it: nothing — it returns null, and every label needs a human.
  Layout OCR reports bounding boxes and
  sometimes a coarse style flag; it does not reliably report stroke weight
  relative to adjacent body text. Bold detection may have to be rebuilt from
  glyph geometry, or FR-7 downgraded to "cannot determine" — which resolves to
  REVIEW, not PASS, so it is safe, but it hands work back to the agents.
- Verify the specific service is in the FedRAMP-authorised set for TTB's
  tenant. Azure-wide authorisation does not extend automatically to every AI
  service.

**Rough shape:** 2–4 engineer-weeks including field mapping and re-validation,
plus procurement/security lead time that is outside engineering's control.

### 3b. Self-hosted vision model (Qwen2-VL, Llama 3.2 Vision) on GPU

**Why it is viable:** it removes the outbound call entirely. The model runs on
TTB hardware, artwork never leaves the network, and the firewall question
disappears. It is also the closest functional match to what exists today — an
open-weights VLM can populate the same `ExtractedLabel` from the same prompt,
so §2's seam is genuinely drop-in.

**What it costs, honestly:**
- **GPU hardware is required.** A 7B-class VLM at usable latency needs roughly
  a 24GB accelerator; a larger model needs more, and any real deployment needs
  redundancy, not one card. Treat these as planning figures to be benchmarked,
  not quotes.
- **CPU inference is not a fallback.** See §5 — it reproduces the exact latency
  failure that killed the last vendor.
- **Transcription accuracy must be measured before it is trusted, not
  assumed.** These models are strong at describing images and materially weaker
  at exact character-level reading of small print. This app's warning check is
  literal string equality against the 27 CFR 16.21 text — see §6. A model that
  is "basically right" is wrong here.
- It adds a service to operate: model updates, GPU drivers, monitoring,
  capacity for batch runs at concurrency 6.

**Rough shape:** 1–2 engineer-weeks to integrate, dominated afterwards by
benchmarking and by hardware procurement lead time.

### 3c. Traditional OCR (Tesseract, PaddleOCR)

**Why it is on the list:** no ML endpoint at all, CPU-only, open source, no
procurement, no GPU. Deployable inside the network in days. As a floor option
it is real.

**What it costs, honestly:**
- It is weak on exactly the inputs this domain produces: stylised and script
  typefaces, foil and embossed type, text curved around a bottle, low-contrast
  warning text over busy artwork, and photographs taken at an angle — the
  `stones-throw-tilted` fixture is representative of normal agent input, not an
  edge case. FR-21 (tolerate angled, glared, poorly-lit photographs) is the
  requirement most at risk.
- Same field-mapping burden as 3a — it returns text, not fields — and the same
  `headingBold` problem, more acutely.
- Character-level errors on stylised type feed straight into the exact-match
  warning check (§6).

Reasonable as a hedge or a preprocessing stage. Not a credible sole path to the
current behaviour.

---

## 4. Validation any swap must pass before it is trusted

The swap is not done when the types compile. Minimum bar:

1. The unit suite still passes (`npm test`). It will — no test calls a model.
   Passing it proves the seam held, **not** that the new backend reads labels.
   Do not let a green suite stand in for the checks below.
2. Every fixture in `samples/` produces the same verdict as today:
   `old-tom` PASS, `wrong-abv` FAIL on ABV, `title-case-warning` FAIL on the
   warning, `unbolded-warning` FAIL on FR-7, `stones-throw-tilted` clean under
   tilt. Five fixtures is a smoke test, not an evaluation set.
3. Character-exact reproduction of the warning text on every fixture that
   carries one, repeated several times per fixture — transcription is not
   deterministic and a single clean run proves little.
4. Latency measured under the real deployment, at batch concurrency 6, against
   NFR-1's 5-second budget.
5. A labelled set of genuine artwork, which does not exist yet. This is the
   largest unbudgeted item in any of these options and the honest reason none
   of them can be signed off from a desk.

---

## 5. What does not work

**An orchestration framework is not a solution.** LangChain, LlamaIndex and
similar do not remove the network call. They wrap a provider; they are not
models. Routing the same request to `api.anthropic.com` through an abstraction
layer leaves the firewall exactly where it was, and adds a dependency. If a
framework appears in a proposal as the answer to this problem, the proposal has
misread the problem.

**CPU inference of a vision model is not a way to avoid buying GPUs.** A VLM on
CPU lands in the 30–40 second range per image. That is the precise latency that
made agents abandon the previous vendor's tool and that Sarah Chen killed a
vendor over. Shipping it would trade a tool that cannot connect for a tool
nobody uses — a worse outcome, because it also burns the credibility of the
next attempt.

**A cheaper or smaller model is not a free lever.** See §6.

---

## 6. Why transcription accuracy is not negotiable here

The government warning check (FR-5, 27 CFR 16.21) is literal string equality
after whitespace collapsing. There is no fuzzy match and no tolerance, by
design — Jenny Park caught an application whose only defect was title case, and
"close enough" is a rejection in this domain.

That design amplifies transcription error rather than absorbing it. A single
wrong character anywhere in the ~250-character warning flips the verdict, and
the failures run in both directions:

- A misread character in a compliant warning produces a **false FAIL**, and the
  agent spends longer disproving the tool than they would have spent checking
  the label themselves.
- A model that "helpfully" reproduces the statutory text from memory instead of
  reading what is printed produces a **false PASS** on a genuinely defective
  label. That is the failure direction that matters, and it is the specific
  reason the system prompt tells the model to transcribe misspellings verbatim.
  A weaker model is more likely to fall back on memorised text, not less.

The consequence for this migration: **a model swap that costs a few points of
character accuracy is not a small regression.** It is the difference between a
tool agents trust and a tool they route around — and once they route around it,
the throughput case for the whole project is gone. Any candidate backend must
be benchmarked on exact warning reproduction specifically, not on general OCR
accuracy scores, before it is put in front of an agent.

---

## 7. Recommendation

1. Confirm with TTB IT whether an allowlist entry for the current endpoint is
   possible. Cheapest outcome by a wide margin; ask before engineering
   anything.
2. In parallel, scope Azure AI Vision / Document Intelligence (§3a). It is the
   likeliest approvable path and the field-mapping work is the long pole.
3. Keep self-hosting (§3b) as the fallback if artwork cannot leave the network
   at all, and start hardware procurement early — that lead time, not the code,
   dominates the schedule.
4. Build the labelled evaluation set (§4.5) regardless of which path is chosen.
   It is needed to trust any of them, including the current one.
