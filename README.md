# Label Check

Compares alcohol beverage label artwork against the data in a COLA application
and tells an agent, in one glance, whether they match.

Built for the take-home brief in `../instructions/README.md`.

Reviewer shortcuts: [Approach](#approach) · [Tools used](#tools-used) ·
[Assumptions](#assumptions) · [What the interviews asked for](#what-the-interviews-asked-for) ·
[Limitations and trade-offs](#limitations-and-trade-offs) ·
[Known deployment blocker](#known-deployment-blocker-outbound-network-access)

---

## Running it

```bash
npm install
cp .env.example .env.local        # then paste your key in
npm run dev                       # http://localhost:3000
```

You need an Anthropic API key from
[console.anthropic.com](https://console.anthropic.com/settings/keys).

```bash
npm test          # comparison logic (18 tests, no API key needed)
npm run typecheck
npm run build
```

### Verifying it end to end

Four synthetic labels ship in `samples/` — one compliant, three with specific
defects. With the server running:

```bash
node scripts/smoke-test.mjs samples/old-tom.png
```

It prints the per-field verdict and the round-trip time, and warns if the
request exceeded the 5-second budget.

To regenerate or add fixtures (renders HTML via headless Chrome, macOS path):

```bash
node scripts/make-samples.mjs
```

### Measured results

Every sample below was run end to end against the live API.

| Sample | Expected | Result | Round trip |
|---|---|---|---|
| `old-tom` | all fields match | PASS | 4.15s |
| `title-case-warning` | rejected — `Government Warning:` in title case | FAIL on warning | 3.80s |
| `wrong-abv` | rejected — label 40%, application 45% | FAIL on alcohol | 4.25s |
| `stones-throw-tilted` | pass — `STONE'S THROW` vs `Stone's Throw`, `0.75 L` vs `750 mL`, rotated 7° | PASS | 4.26s |

The last one is the interesting case: it exercises Dave's capitalization
point, unit normalization, and an off-angle photograph in a single label, and
all three resolve correctly without agent intervention.

---

## Approach

```
label image ──▶ Claude Sonnet 5 vision ──▶ verbatim transcription (JSON)
                                                    │
application data ───────────────────────────────────┤
                                                    ▼
                                       lib/compare.ts (plain TypeScript)
                                                    ▼
                                       PASS / REVIEW / PROBLEM per field
```

**The model transcribes. It does not decide.** Every match, mismatch, and
tolerance judgement happens in `lib/compare.ts` as ordinary code. That split is
the central design decision here, and the reason for it is auditability:

- A compliance verdict is reproducible. The same inputs always give the same
  answer, which matters when an applicant disputes a rejection.
- The rules are readable and reviewable by someone who is not an ML engineer.
  A regulation change is a diff in a comparison function, not a prompt rewrite
  and a re-evaluation.
- Each verdict can be traced to a specific line of code and a specific CFR
  citation. Nothing is hidden inside a model's judgement.
- The government warning check is exact string equality against the statutory
  text in `lib/warning.ts`, so it cannot be talked into "close enough."

The model is asked for one thing it is genuinely better at than code — reading
text off a photograph that may be angled, glared, or badly lit — and is given a
strict JSON schema (`output_config.format`) so the response shape is guaranteed.
`lib/extract.ts` is the only file in the project that talks to a model, and it
contains no compliance logic at all.

### The three verdicts

| Verdict | Meaning |
|---|---|
| **Match** | Agrees with the application. No action. |
| **Check** | Close but not identical. A human decides. |
| **Problem** | Clear mismatch, or a missing mandatory element. |

The middle one exists because of Dave's point in the interview: `STONE'S THROW`
on the label versus `Stone's Throw` on the form is technically a mismatch and
obviously the same thing. Case and punctuation differences alone are treated as
a **Match**; genuinely similar-but-different values (`OLD TOM DISTILLERY` vs
`OLD TOM DISTILLERIES`) surface as **Check** rather than being auto-failed.

### What each field checks

- **Brand name / class-type** — exact, then case- and punctuation-insensitive,
  then edit-distance similarity for the Check band.
- **Alcohol content** — parsed to a number, so `45% Alc./Vol.` and `90 Proof`
  compare correctly. Differences inside the TTB labelling tolerance (0.15%, 27
  CFR 5.65) are a Check, not a failure. A label whose stated proof isn't twice
  its stated ABV fails on internal inconsistency regardless of the application.
- **Net contents** — normalized to millilitres, so `0.75 L` matches `750 mL`.
- **Government warning** — exact text match against 27 CFR 16.21, ignoring only
  line breaks. Title case fails. Altered wording fails, and the message names
  the first word that diverges rather than making the agent diff two
  paragraphs.

---

## Tools used

| Tool | Why |
|---|---|
| **Next.js 16 + React 19** | One framework for the UI and the API route, so upload handling, validation, and rendering live in one deployable unit. No separate backend to stand up for a prototype. |
| **TypeScript** | The compliance rules are the deliverable. Types make the comparison functions in `lib/compare.ts` reviewable and keep the model's JSON from leaking untyped into the decision path. |
| **Claude vision API — `claude-sonnet-5`** (`@anthropic-ai/sdk`) | Transcription off imperfect photographs is the one task here that code does badly. Model choice was made by measurement, not assumption: Opus 4.8 averaged 5.6s and peaked at 8.2s against a 5-second requirement; Sonnet 5 averages ~4.1s with identical verdicts on every fixture. `ANTHROPIC_MODEL` overrides it for re-benchmarking. Thinking is disabled and effort is `low` — transcription is perception, not reasoning. |
| **Tailwind CSS v4** | Styling without inventing a design system for a prototype. The accessibility requirements here (18px base, large targets, high contrast) are a handful of utility classes, not a component library. |
| **Railway** | Stateless container deploy from a repo with one config file. No infrastructure decisions to defend in a proof of concept. |
| **Headless Chrome** (`scripts/make-samples.mjs`) | Test fixtures are generated by rendering HTML labels to PNG. This makes defects deliberate and reproducible — the title-case warning fixture differs from the compliant one by exactly one CSS property, so a failing test points at one cause. |
| **`node:test`** (built in) | 18 tests over the decision logic, run with `node --test --experimental-strip-types`. No test framework dependency, no config file, no transpile step. |

Deliberate non-choices, since each one is a dependency the prototype did not
earn:

- **No database.** Nothing is persisted, so there is nothing to store.
- **No ORM.** Follows from the above.
- **No CSV library.** `lib/csv.ts` is a small RFC 4180 parser. The manifest
  format is fully specified and the parser is under a hundred lines; a
  dependency here would be larger than the code it replaces.
- **No image-processing library.** Downscaling oversized uploads happens in the
  browser with a canvas element. The server never manipulates pixels.
- **No auth / session library.** There is no login. See Assumptions.

Total runtime dependency count: four (`next`, `react`, `react-dom`,
`@anthropic-ai/sdk`).

---

## What the interviews asked for

Honest mapping, including the gap.

| Requirement | How it is handled | Where |
|---|---|---|
| Compare label artwork to application data | Vision transcription plus field-by-field comparison | `lib/extract.ts`, `lib/compare.ts` |
| Results in about 5 seconds | One model call, thinking disabled, `effort: low`, browser-side downscaling. Measured 3.8–4.3s; elapsed time shown on every result | `lib/extract.ts` |
| Government warning must be exact | Character-level equality against 27 CFR 16.21, plus a separate all-caps heading check | `lib/warning.ts` |
| Capitalization shouldn't fail a label | Case and punctuation differences alone resolve to Match; near-misses become Check | `lib/compare.ts` |
| Unit differences (`0.75 L` vs `750 mL`) | Net contents normalized to millilitres before comparison | `lib/compare.ts` |
| Imperfect photographs | Image quality reported separately from compliance; unreadable images ask for a better photo rather than rejecting the application | `lib/compare.ts`, `components/ResultPanel.tsx` |
| Something a non-technical user can operate | Two numbered steps, one button, plain-language verdicts, 18px base font, every result states its reason in a sentence | `components/` |
| Batch uploads | CSV manifest plus multi-select image picker matched on filename; six concurrent requests, live progress, downloadable results CSV | `components/BatchCheck.tsx`, `lib/csv.ts` |
| "You need judgment" — don't auto-approve | The Check verdict exists, and the footer states results assist review rather than replace it | `components/Verdict.tsx` |
| **Font size / type-size requirements** | **Not implemented.** The brief's "smaller font" concern is only partly addressed — altered or title-case warning text is caught, but warning text that is merely too small is not. This needs pixel measurement against known label dimensions, not transcription. | — |
| **Audit trail of who checked what** | **Not implemented.** Nothing is persisted, by design for a prototype; a production tool would need this. | — |

---

## Assumptions

- **Standalone prototype.** No COLA integration, no authentication, no
  database. Marcus described this as a proof of concept that might inform
  procurement, so nothing here assumes a production security boundary.
- **Nothing is persisted.** Images are held in memory for the duration of one
  request and never written to disk or logged, which sidesteps the PII and
  retention questions Marcus raised for a prototype.
- **Distilled spirits are the reference case.** The sample in the brief is a
  bourbon. Wine and malt beverages have different mandatory fields and
  different ABV tolerances; the field list is fixed rather than
  beverage-type-aware.
- **US 27 CFR 16.21 warning text only.** No handling of export labels or
  alternate language requirements.
- **Application data is typed in or supplied by CSV.** Reading the COLA form
  itself is out of scope.
- **One label image per application.** Front and back labels submitted as
  separate images would each be checked independently against the full field
  list, which is not how a real multi-panel submission works.
- **Outbound HTTPS to `api.anthropic.com` is available.** This one is
  load-bearing and is probably false on TTB's network — see below.

---

## Known deployment blocker: outbound network access

Marcus (IT) said their network blocks outbound traffic to many domains, and
that the previous vendor's ML endpoints were firewall-blocked. **This app calls
`api.anthropic.com` on every request.** Behind TTB's firewall it would fail in
exactly the same way that vendor did — every check would return a connection
error, and no amount of application-level work would fix it.

I am not going to claim this is solved. It is a real constraint that would have
to be resolved before a pilot, and the resolution is a network and procurement
question, not a code question. The realistic options are an allowlist entry for
the API endpoint, or a self-hosted model.

What the architecture does buy is that the second option is not a rewrite.
All model access is isolated to `lib/extract.ts` — one function, one JSON
schema, one return type. A self-hosted vision model that produces the same
`ExtractedLabel` shape could be substituted there without touching
`lib/compare.ts`, `lib/warning.ts`, or any test. The compliance engine has no
knowledge of which model produced the transcription, and the 18 tests would
still pass unchanged.

That is a smaller migration than the alternative, not a free one: a substituted
model would need its own accuracy measurement against the fixtures, and a
self-hosted model on TTB hardware would very likely miss the 5-second budget
that the interviews treated as non-negotiable.

---

## Limitations and trade-offs

- **Not evaluated against real labels.** The fixtures are clean synthetic
  renders. Accuracy on genuine artwork — foil stamping, script typefaces,
  curved glass, warning text overprinted on a busy background — is unmeasured,
  and that is the gap I would close first with a labelled test set.
- **The latency margin is thin.** Measured 3.8–4.3s against the 5-second
  target, on a fast connection with modest images. A large photo on a
  government network could exceed it. The headroom is real but not generous,
  and it should be re-measured on TTB infrastructure before anyone promises
  the number to agents.
- **A false pass is the dangerous failure mode.** If the model misreads small
  warning text as correct, the app reports a clean bill. The exact-match check
  makes silent corruption unlikely, but nothing here detects a confidently
  wrong transcription — which is why the tool assists review rather than
  replacing it.
- **Batch is client-orchestrated.** 300 labels means 300 requests from the
  browser. Fine for a prototype; a production version would want a queue with
  a resumable job, since closing the tab currently loses in-flight progress.
- **Text-only extraction.** Font size and placement requirements (the warning
  must meet minimum type size) are not checked. That needs pixel measurement
  against a known label dimension, not transcription.
- **Similarity threshold (0.82) is unvalidated.** It should be tuned against
  real mismatch data; right now it is a reasonable guess.
- **No audit trail.** A production compliance tool would need to record who
  checked what and when.
- **Depends on a third-party API being reachable.** See the section above.

---

## Deploying to Railway

```bash
railway init
railway variables --set ANTHROPIC_API_KEY=sk-ant-...
railway up
```

`railway.json` sets the build and start commands; `npm run start` binds
`$PORT`, which Railway injects. No other configuration is needed — the app is
stateless and stores nothing.

## Layout

```
app/
  page.tsx              mode switch
  api/verify/route.ts   upload validation, orchestration, error mapping
lib/
  extract.ts            the only file that talks to the model
  compare.ts            all compliance decisions
  warning.ts            statutory warning text and exact-match checking
  csv.ts                RFC 4180 manifest parsing
  types.ts              shared shapes, including ExtractedLabel
components/             UI
test/compare.test.ts    18 tests over the decision logic
scripts/smoke-test.mjs  end-to-end check with timing
scripts/make-samples.mjs  renders test label artwork via headless Chrome
samples/                four fixtures: one clean, three with known defects
```

## Cost

Roughly **$0.01 per label** on the Sonnet 5 default, measured across the
fixtures above. `ANTHROPIC_MODEL` overrides the model if you want to
re-benchmark; Opus 4.8 produced identical verdicts at ~4x the cost and ~40%
more latency, which is why it isn't the default.
