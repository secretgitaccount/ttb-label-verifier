# Label Check

Compares alcohol beverage label artwork against the data in a COLA application
and tells an agent, in one glance, whether they match.

Built for the take-home brief in `../instructions/README.md`.

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

## How it works

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
the central design decision here:

- A compliance verdict is reproducible. The same inputs always give the same
  answer, which matters when an applicant disputes a rejection.
- The rules are auditable. A regulation change is a diff in a comparison
  function, not a prompt rewrite and a re-evaluation.
- The government warning check is exact string equality against the statutory
  text in `lib/warning.ts`, so it cannot be talked into "close enough."

The model is asked for one thing it is genuinely better at than code — reading
text off a photograph that may be angled, glared, or badly lit — and is given a
strict JSON schema (`output_config.format`) so the response shape is guaranteed.

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

### Design decisions driven by the interviews

| From the brief | What it changed |
|---|---|
| "If we can't get results back in about 5 seconds, nobody's going to use it" | One model call per label, thinking disabled, `effort: low`. Transcription is perception, not reasoning — there is nothing to deliberate about. Model choice was made by measurement, not assumption: Opus 4.8 averaged 5.6s and peaked at 8.2s, so the default is Sonnet 5 at ~4.1s with identical verdicts on every fixture. Oversized uploads are downscaled in the browser, worth about another second. Elapsed time is shown on every result so the constraint stays visible in use. |
| "Something my mother could figure out" | Two numbered steps, one big button, plain words. Verdicts read "Everything matches" / "Needs your review" / "Problems found", never "PASS/FAIL". Base font is 18px and every result states its reason in a sentence. |
| "Handle batch uploads" | A CSV manifest plus a multi-select image picker, matched on file name. Six requests in flight at once, with live progress and a results CSV to download — an agent working 300 applications needs an artifact, not a screen. |
| "The warning has to be **exact**" | Character-level comparison against the statute, plus a separate all-caps check on the heading, which is the violation Jenny catches most often. |
| "Images that aren't perfectly shot" | Image quality is reported separately from compliance. An unreadable photo asks for a better image instead of rejecting the application — but a warning defect that *was* legible still fails, so blur can't be used to launder a bad label. |
| "You can't just pattern match everything. You need judgment." | The Check verdict, and the decision never to auto-approve — the footer states results assist review rather than replace it. |

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
  must meet minimum type size) are not checked — the brief's "smaller font"
  concern is only partly addressed. That needs pixel measurement against a
  known label dimension, not transcription.
- **Similarity threshold (0.82) is unvalidated.** It should be tuned against
  real mismatch data; right now it is a reasonable guess.
- **No audit trail.** A production compliance tool would need to record who
  checked what and when.

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
