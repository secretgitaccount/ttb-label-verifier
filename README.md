# Label Check

Compares alcohol beverage label artwork against the data in a COLA application
and tells an agent, in one glance, whether they match.

Built for the take-home brief in `../instructions/README.md`.

Reviewer shortcuts: [Approach](#approach) · [Tools used](#tools-used) ·
[Assumptions](#assumptions) · [What the interviews asked for](#what-the-interviews-asked-for) ·
[Limitations and trade-offs](#limitations-and-trade-offs) ·
[Deployment constraints](#deployment-constraints) ·
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
npm test          # 37 tests, no API key needed
npm run typecheck
npm run build
```

`npm test` runs both suites: `test/compare.test.ts` (26 tests over the decision
logic) and `test/extract.test.ts` (11 tests over the model-response validator).
Neither makes a network call.

### Verifying it end to end

Five synthetic labels ship in `samples/` — one compliant, four with specific
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

Every sample below was run end to end against the live API on a developer
laptop, using the standard application data in `samples/manifest.csv`.

| Sample | Expected | Result |
|---|---|---|
| `old-tom` | all fields match | PASS |
| `title-case-warning` | rejected — `Government Warning:` in title case | FAIL on warning |
| `wrong-abv` | rejected — label 40%, application 45% | FAIL on alcohol |
| `unbolded-warning` | rejected — heading correct and ALL CAPS, but set at the same weight as the body text | FAIL on warning |
| `stones-throw-tilted` | pass — `STONE'S THROW` vs `Stone's Throw`, `0.75 L` vs `750 mL`, rotated 7° | PASS |

`stones-throw-tilted` is the interesting pass: it exercises Dave's
capitalization point, unit normalization, and an off-angle photograph in a
single label, and all three resolve correctly without agent intervention.
`unbolded-warning` is the interesting fail: its source HTML differs from
`old-tom` by exactly one CSS property — the heading's font weight — and the
heading is still ALL CAPS, so a FAIL there can only have come from the bold
check.

### Measured latency

**These numbers are from a developer laptop on a home connection. Nothing here
has been measured on TTB infrastructure, and these figures should not be quoted
to agents until it has been.**

Full HTTP round trip, `old-tom`, n=10 consecutive runs against a local server:

| min | median | p90 | max |
|---|---|---|---|
| 3.81s | 4.47s | 5.02s | 6.98s |

**The 5-second requirement is met at the median and missed in the tail.** The
p90 is just over the limit and the worst run was 6.98s. An earlier sample of n=3
suggested a comfortable 4.1–4.2s; widening to n=10 showed that was optimistic,
and the honest figure is a distribution with a long right tail, not a tight
range. Measuring the same build twice at n=10 moved the median by 0.03s and the
max by 0.7s, so treat the tail figure as indicative rather than precise.

The variance is in the model call and the network, not in this application —
local compute is negligible (base64 encoding is sub-millisecond and `verify()`
is pure synchronous TypeScript with no I/O). Nothing in the current design
brings the tail under 5s without either a faster model or accepting a weaker
transcription guarantee, and the latter is not a trade this tool should make:
verbatim warning transcription is what makes the exact-match check auditable.

Sarah's constraint was that agents abandon a tool that is slower than doing the
work by eye. At ~4.4s typical this clears that bar; at 6.3s worst case it does
not. That gap is real and is stated here rather than averaged away. See
[Limitations](#limitations-and-trade-offs).

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

The schema makes a malformed response unlikely, not impossible, so
`validateExtractedLabel` re-checks every field's shape and type before the JSON
becomes an `ExtractedLabel`. A bad payload fails at that seam with one plain
sentence on screen — *"The label was read but the response was not in the
expected format (netContents should be text but was number). Try again."* —
rather than surfacing three calls later as a null dereference in the decision
path. The validator checks shape only; it makes no compliance judgement.

### The three verdicts

| Verdict | Internal name | Meaning |
|---|---|---|
| **Match** | `PASS` | Agrees with the application. No action. |
| **Check** | `REVIEW` | Not settled by code. A human decides. |
| **Problem** | `FAIL` | Clear mismatch, or a missing mandatory element. |

The overall verdict is the worst field verdict: any Problem makes the
application a Problem, otherwise any Check makes it a Check (`rollUp` in
`compare.ts`).

**Check** covers three distinct situations, not just one:

1. **Similar but not identical.** Dave's point in the interview: `STONE'S THROW`
   on the label versus `Stone's Throw` on the form is technically a mismatch and
   obviously the same thing. Case and punctuation differences alone are treated
   as a **Match**; genuinely similar-but-different values (`OLD TOM DISTILLERY`
   vs `OLD TOM DISTILLERIES`) surface as **Check** rather than being
   auto-failed. Same for an ABV inside the 0.15% tolerance.
2. **Something could not be determined from the image.** A label whose warning
   text is perfect but whose heading weight the model could not read returns
   Check, not Match. See below.
3. **An unreadable photograph, where the only failures are missing fields.** If
   `imageQuality.readable` is false and every failing field failed because
   nothing was found (`found === null`), the overall Problem is softened to
   Check — that is a request for a better photo, not a rejection. A failure the
   model *could* read, such as altered warning wording, is never softened this
   way.

### What each field checks

- **Brand name / class-type** — exact, then case- and punctuation-insensitive,
  then edit-distance similarity for the Check band.
- **Alcohol content** — parsed to a number, so `45% Alc./Vol.` and `90 Proof`
  compare correctly. Differences inside the TTB labelling tolerance (0.15%, 27
  CFR 5.65) are a Check, not a failure. A label whose stated proof isn't twice
  its stated ABV fails on internal inconsistency regardless of the application.
- **Net contents** — normalized to millilitres, so `0.75 L` matches `750 mL`.
  A value neither side can be parsed as a volume falls back to the text
  comparison above.
- **Government warning** — three separate checks, described next.

#### The government warning: three checks, not one

`compareWarning` in `lib/compare.ts` checks the warning on three axes and
reports **all** the defects it finds in one message, most severe first — a label
can be wrong in more than one way, and reporting only the first defect buys a
second bad submission.

| Check | Source | Failing it |
|---|---|---|
| **Exact text** | `checkWarningText` in `lib/warning.ts` — character equality against 27 CFR 16.21, collapsing whitespace so line breaks don't matter | Problem. The message names the first word that diverges rather than making the agent diff two paragraphs |
| **ALL-CAPS heading** | The model's direct reading of the artwork (`headingAllCaps`), falling back to a regex over the transcription | Problem. This is the title-case case Jenny described |
| **Bold heading** | The model's reading of type weight only (`headingBold`) — there is no way to re-derive stroke weight from transcribed text | `false` → Problem. `null` → **Check** |

The caps check prefers the model's reading over the transcription because
rendering survives transcription poorly. The bold check has no such second
source, which drives the Check path:

**A fully-matching label returns Check when heading weight cannot be
determined.** If the wording is exact and the heading is ALL CAPS but the model
reports `headingBold: null` — too small, too blurry, too stylised to tell — the
field returns Check with the reason *"Warning text matches, but whether the
'GOVERNMENT WARNING:' heading is printed in bold could not be determined from
this image. Check the heading weight."* Match on the warning field is only
reachable when `headingBold` is explicitly `true`.

That is deliberate. Treating an uncertain signal as a failure would reject
compliant labels for being photographed badly; treating it as a pass would
approve a light-type heading, which is precisely the false approval the check
exists to prevent. Check auto-approves nothing and puts the one question a human
can settle in front of a human. The practical consequence for an agent: **on
real-world photographs, expect more Checks on the warning field than the
synthetic fixtures suggest.**

#### Bottler address and country of origin: not implemented

The brief lists "Name and address of bottler/producer" and "Country of origin
for imports" among the common required elements. **Neither is verified.**

Both were built during development and then deliberately removed. The
implementation was complete in the library — types, extraction schema, and a
comparison path — but nothing in the running app could reach it: no form field
collected the values and no CSV column carried them, so the comparison branches
never executed. Half-wired code that costs latency on every request and delivers
nothing to an agent is worse than an honest gap, so it was reverted rather than
left in to look more complete than it was.

Removing them returned ~7% of the output tokens. That turned out to be within
measurement noise rather than the ~0.3s it was estimated to be worth, which is
itself worth recording: the estimate was wrong, and the latency ceiling is the
warning transcription, not field count.

Finishing them properly means a form field, a CSV column, a fixture that renders
an address, and end-to-end proof that the model reads it — not just restoring
the deleted code. That is scoped work, not a leftover.

---

## Tools used

| Tool | Why |
|---|---|
| **Next.js 16 + React 19** | One framework for the UI and the API route, so upload handling, validation, and rendering live in one deployable unit. No separate backend to stand up for a prototype. |
| **TypeScript** | The compliance rules are the deliverable. Types make the comparison functions in `lib/compare.ts` reviewable and keep the model's JSON from leaking untyped into the decision path. |
| **Claude vision API — `claude-sonnet-5`** (`@anthropic-ai/sdk`) | Transcription off imperfect photographs is the one task here that code does badly. Model choice was made by measurement, not assumption: Opus 4.8 averaged 5.6s and peaked at 8.2s against a 5-second requirement, while Sonnet 5 medians 4.0–4.1s with identical verdicts on every fixture. (The Sonnet figures were re-measured this round; the Opus comparison is carried over from an earlier session and has not been re-run.) `ANTHROPIC_MODEL` overrides it for re-benchmarking. Thinking is disabled and effort is `low` — transcription is perception, not reasoning. |
| **Tailwind CSS v4** | Styling without inventing a design system for a prototype. The accessibility requirements here (18px base, large targets, high contrast) are a handful of utility classes, not a component library. |
| **Railway** | Stateless container deploy from a repo with one config file. No infrastructure decisions to defend in a proof of concept. |
| **Headless Chrome** (`scripts/make-samples.mjs`) | Test fixtures are generated by rendering HTML labels to PNG. This makes defects deliberate and reproducible — the title-case warning fixture differs from the compliant one by exactly one CSS property, so a failing test points at one cause. |
| **`node:test`** (built in) | 37 tests over the decision logic and the model-response validator, run with `node --test --experimental-strip-types`. No test framework dependency, no config file, no transpile step. |

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
| Results in about 5 seconds | One model call, thinking disabled, `effort: low`, browser-side downscaling. Round trip measured at median 4.44s / p90 4.95s / max 6.29s (n=10, local). **Met at the median, missed in the tail**; elapsed time shown on every result | `lib/extract.ts` |
| Government warning must be exact | Character-level equality against 27 CFR 16.21, plus separate all-caps and bold heading checks; all defects found are reported together | `lib/warning.ts`, `lib/compare.ts` |
| Capitalization shouldn't fail a label | Case and punctuation differences alone resolve to Match; near-misses become Check | `lib/compare.ts` |
| Unit differences (`0.75 L` vs `750 mL`) | Net contents normalized to millilitres before comparison | `lib/compare.ts` |
| Imperfect photographs | Image quality reported separately from compliance; unreadable images ask for a better photo rather than rejecting the application | `lib/compare.ts`, `components/ResultPanel.tsx` |
| Something a non-technical user can operate | Two numbered steps, one button, plain-language verdicts, 18px base font, every result states its reason in a sentence | `components/` |
| Batch uploads | CSV manifest plus multi-select image picker matched on filename; six concurrent requests, live progress, downloadable results CSV | `components/BatchCheck.tsx`, `lib/csv.ts` |
| "You need judgment" — don't auto-approve | The Check verdict exists, an unreadable heading weight routes to Check rather than either extreme, and the footer states results assist review rather than replace it | `components/Verdict.tsx`, `app/layout.tsx` |
| **Font size / type-size requirements** | **Partly implemented.** Heading *weight* is checked — a warning heading set in light type fails. Heading and body *size* are not: warning text that is correct, capitalised, bold, and simply too small still passes. Size needs pixel measurement against known label dimensions, not transcription. | `lib/compare.ts` (weight only) |
| **Bottler address / country of origin** | **Not implemented.** Built during development, then reverted — the library code was unreachable from the UI and CSV importer. See above. | — |
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
`lib/compare.ts` or `lib/warning.ts`. The compliance engine has no knowledge of
which model produced the transcription, and the 26 tests in
`test/compare.test.ts` would still pass unchanged. (`test/extract.test.ts` tests
the boundary itself, so those 11 would need revisiting; and
`app/api/verify/route.ts` imports `Anthropic.APIError` for error mapping, so
`extract.ts` is not literally the only provider-coupled file.)

That is a smaller migration than the alternative, not a free one: a substituted
model would need its own accuracy measurement against the fixtures, and a
self-hosted model on TTB hardware would very likely miss the 5-second budget
that the interviews treated as non-negotiable.

---

## Deployment constraints

The firewall problem above is the one blocker that application code cannot
solve. **[`docs/MIGRATION.md`](docs/MIGRATION.md)** works it through in detail:
what exactly is coupled to the provider, the three realistic options (endpoint
allowlist, Azure, self-hosted GPU) with the honest cost of each, the validation
bar any swap has to clear before it is trusted, and what does not work and why.
Its status line for the underlying risk is "unsolved", which is accurate.

The effort and hardware figures in that document are labelled planning
estimates. They were not benchmarked and contain no verified pricing.

---

## Limitations and trade-offs

- **Not evaluated against real labels.** The fixtures are clean synthetic
  renders. Accuracy on genuine artwork — foil stamping, script typefaces,
  curved glass, warning text overprinted on a busy background — is unmeasured,
  and that is the gap I would close first with a labelled test set.
- **The latency margin is thin.** Model call measured at 4.0–4.5s against a
  5-second target, on a developer laptop and a fast connection with modest
  images, and the browser round trip is inferred rather than measured. A large
  photo on a government network could exceed it. The headroom is real but not
  generous, and it should be re-measured on TTB infrastructure before anyone
  promises the number to agents. The call itself is already close to its floor
  — cheapest capable model, thinking disabled, `effort: low` — so the remaining
  savings are in the schema, not the configuration.
- **The bold check is proven, not stress-tested.** The heading-weight check
  fires correctly on real artwork, but the evidence is a handful of runs on
  synthetic 11.5px Helvetica where the weight difference is 400 vs 700 — a
  clean, high-contrast case. It is not a stability run. On photographed or
  low-resolution labels the honest expectation is more `null` readings and
  therefore more Checks. Before anyone treats a bold failure as a hard
  rejection in production it needs a repeat run over more samples, including at
  least one photographed label.
- **A false pass is the dangerous failure mode.** If the model misreads small
  warning text as correct, the app reports a clean bill. The exact-match check
  makes silent corruption unlikely, but nothing here detects a confidently
  wrong transcription — which is why the tool assists review rather than
  replacing it.
- **Batch is client-orchestrated.** 300 labels means 300 requests from the
  browser. Fine for a prototype; a production version would want a queue with
  a resumable job, since closing the tab currently loses in-flight progress.
- **Type size and placement are not checked.** Heading weight is; heading and
  body *size* are not, nor is placement. A warning that is correct, capitalised,
  bold, and half the required height passes. That needs pixel measurement
  against a known label dimension, not transcription.
- **Similarity threshold (0.82) and the 0.15% ABV tolerance are unvalidated
  against real data.** Both are defensible readings of the regulation rather
  than tuned constants; they should be checked against real mismatch data.
- **Two fields are built but unreachable.** Bottler address and country of
  origin have types, an extraction schema, and comparison logic, but no UI or
  CSV input feeds them. They cost output tokens on every request and compare
  nothing.
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
  layout.tsx            shell; the "results assist review" footer lives here
  page.tsx              mode switch
  api/verify/route.ts   upload validation, orchestration, error mapping
lib/
  extract.ts            the only file that talks to the model; also validates its JSON
  compare.ts            all compliance decisions
  warning.ts            statutory warning text and exact-match checking
  csv.ts                RFC 4180 manifest parsing
  types.ts              shared shapes, including ExtractedLabel
components/             UI
test/compare.test.ts    26 tests over the decision logic
test/extract.test.ts    11 tests over the model-response validator
docs/MIGRATION.md       running without api.anthropic.com
scripts/smoke-test.mjs  end-to-end check with timing
scripts/make-samples.mjs  renders test label artwork via headless Chrome
samples/                five fixtures: one clean, four with known defects
```

## Cost

One model call per label. Measured token usage on the fixtures is **~2,950
input tokens and ~250 output tokens**, which is the number to multiply by
current pricing — the per-label dollar figure previously quoted here is removed
because it was not re-verified against current rates.

The output is dominated by the government warning: of ~610 characters of JSON,
the warning object is ~350 and its `text` field alone ~283. That is the floor,
not a target — the exact-match check is the point of the tool. The ~45
characters spent on `bottlerAddress` and `countryOfOrigin` are the part that
currently buys nothing (see above).

`ANTHROPIC_MODEL` overrides the model if you want to re-benchmark. Opus 4.8 was
measured slower against the 5-second requirement, which is why Sonnet 5 is the
default.
