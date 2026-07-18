# Product Requirements — Label Check

Derived from the take-home brief in `../../instructions/README.md`, including
requirements stated only inside the stakeholder interviews.

Status legend: **DONE** shipped and verified · **PARTIAL** implemented but not
fully proven · **TODO** not started · **OUT** deliberately out of scope.

---

## 1. Problem

TTB reviews ~150,000 label applications a year with 47 agents. Much of that
review is mechanical comparison: does the number on the form match the number
on the label. Agents describe it as data-entry verification that crowds out
the judgement work only a human can do.

This product automates the comparison and returns a per-field verdict, so an
agent spends their attention on the cases that need it.

It does **not** approve or reject applications. It assists a review.

## 2. Users

| User | Signal from the brief | Design consequence |
|---|---|---|
| Sarah Chen, Deputy Director | Needs throughput; killed a vendor over latency | 5s is a hard requirement, not a target |
| Dave Morrison, 28-yr agent | Sceptical of modernization; values nuance | Must not auto-fail obvious equivalences; must not add friction |
| Jenny Park, 8-month agent | Warning statement must be exact | Character-level checking, all-caps and bold |
| Marcus Williams, IT | Azure shop; firewall blocks external ML endpoints | Model access isolated to one swappable file |
| "Sarah's mother", age 73 | Usability benchmark | Large type, few controls, plain language |

## 3. Functional requirements

### 3.1 Field verification

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| FR-1 | Verify brand name against the application | DONE | `compare.ts`, unit tests, live fixtures |
| FR-2 | Verify class/type designation | DONE | same |
| FR-3 | Verify alcohol content, tolerant of format (`45% Alc./Vol.` vs `90 Proof`) | DONE | numeric parse + 27 CFR 5.65 tolerance |
| FR-4 | Verify net contents across units (`0.75 L` = `750 mL`) | DONE | normalized to mL |
| FR-5 | Verify Government Warning text exactly (27 CFR 16.21) | DONE | string equality, line breaks ignored |
| FR-6 | Verify `GOVERNMENT WARNING:` heading is all caps | DONE | separate structured signal |
| FR-7 | Verify the heading is **bold** | DONE | unit tests + `unbolded-warning` fixture returns FAIL naming bold |
| FR-8 | Verify name/address of bottler or producer | DONE | optional form input + CSV column; `imported-scotch` fixture proves extraction |
| FR-9 | Verify country of origin for imports | DONE | same; absent-from-label returns Check, never Problem |
| FR-10 | Verify minimum type size of the warning | OUT | **two approaches measured and rejected** — see `TYPE-SIZE-FEASIBILITY.md`. Absolute: ±30–40% error. Relative ratio: −27% error, worse than its inputs |

FR-7 was the highest-severity item — a correctly capitalised heading in light
type would have passed, a **false approval**. Closed and demonstrated on
artwork, not just unit-tested.

### 3.2 Verdict semantics

| ID | Requirement | Status |
|---|---|---|
| FR-11 | Three-state verdict: match / needs review / problem | DONE |
| FR-12 | Case and punctuation variance alone must not fail (`STONE'S THROW`) | DONE |
| FR-13 | Similar-but-different values escalate to review, not auto-fail | DONE |
| FR-14 | Any single field problem fails the application overall | DONE |
| FR-15 | Uncertain signals resolve to review, never to approval | DONE |

### 3.3 Throughput

| ID | Requirement | Status |
|---|---|---|
| FR-16 | Single label check | DONE |
| FR-17 | Batch: CSV manifest + multi-image upload, matched on filename | DONE |
| FR-18 | Batch shows live progress and per-row results | DONE |
| FR-19 | Batch results downloadable as CSV | DONE |
| FR-20 | Bounded concurrency so a 300-label batch does not self-DoS | DONE (6) |

### 3.4 Image handling

| ID | Requirement | Status |
|---|---|---|
| FR-21 | Tolerate angled, glared, poorly-lit photographs | DONE |
| FR-22 | Report image quality separately from compliance | DONE |
| FR-23 | An unreadable image requests a better photo rather than rejecting | DONE |
| FR-24 | Legible defects still fail even in a poor image (no laundering) | DONE |

## 4. Non-functional requirements

| ID | Requirement | Target | Status | Measured |
|---|---|---|---|---|
| NFR-1 | Round-trip latency | < 5s, minimise | **NOT MET IN TAIL** | n=10: median 4.47s, p90 5.02s, max 6.98s |
| NFR-2 | Usable without training by low-tech-comfort staff | — | DONE | 18px base, 2 steps, plain-language verdicts |
| NFR-3 | No persistence of images or application data | — | DONE | in-memory for one request |
| NFR-4 | No raw provider errors surfaced to users | — | DONE | mapped in `route.ts` |
| NFR-5 | Compliance logic auditable and reproducible | — | DONE | all decisions in `compare.ts` |
| NFR-6 | Model access isolated for future substitution | — | DONE | `extract.ts` only |
| NFR-7 | Runs behind a restrictive firewall | — | PARTIAL | provider seam is real (`lib/providers/`); Azure adapter written but **never executed**, and it loses FR-7 bold detection |

**NFR-5 is the load-bearing architectural invariant.** The model transcribes;
TypeScript decides. Any change that moves a compliance judgement into the
prompt is a regression regardless of its effect on accuracy.

## 5. Deliverables

| ID | Requirement | Status |
|---|---|---|
| D-1 | Source repository, public | DONE |
| D-2 | README with setup and run instructions | DONE |
| D-3 | Documentation of **approach** | DONE |
| D-4 | Documentation of **tools used** | DONE |
| D-5 | Documentation of **assumptions made** | DONE |
| D-6 | Deployed, reachable application URL | DONE |
| D-7 | Documentation accurately reflects the code | DONE — verified by adversarial review |

## 6. Out of scope

- COLA integration (Marcus: explicitly not wanted for a prototype)
- Authentication, audit trail, multi-user state
- Type-size / font-size measurement (FR-10)
- Beverage-type-aware rules; distilled spirits is the reference case
- Export labels, non-US warning text
- Reading the COLA application form itself; application data is typed or CSV

## 7. Acceptance criteria

The project is submittable when:

1. Every DONE row above is backed by a passing test or a reproducible live run
2. `npm test`, `npx tsc --noEmit`, `npm run build` all pass
3. Latency is measured with an adequate sample, current, and reported as a
   distribution rather than a favourable single figure — including where it
   fails the target
4. The README describes the software that exists — no claimed behaviour is absent, no shipped behaviour is undocumented
5. Every known gap is stated in the README rather than left for a reviewer to find
6. The invariant in NFR-5 holds: no compliance judgement lives in a prompt

## 8. Open decisions

| ID | Decision | Recommendation |
|---|---|---|
| OD-1 | Finish, revert, or document FR-8/FR-9 (optional fields) | **RESOLVED — finished.** Reverted first (unreachable), then wired end to end through the form and CSV importer with a fixture proving extraction. |

No open product decisions remain. Two outstanding risks, both documented rather
than averaged away:

- **NFR-1** — latency is met at the median and missed in the tail.
- **NFR-7** — the provider seam exists, but the Azure adapter has never run, and
  swapping to it would lose FR-7. Firewall operation is designed for, not
  achieved.
