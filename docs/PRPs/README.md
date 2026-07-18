# PRP Backlog

Atomic units of work traced to `../PRD.md`. Each open PRP is written to be
executable by one agent without further context.

## Completed — shipped and verified

These are recorded for traceability. No further work is required.

| PRP | Requirement | Verified by |
|---|---|---|
| PRP-01 | FR-1, FR-2 — brand and class/type comparison, three-tier ladder | 4 unit tests + live fixtures |
| PRP-02 | FR-3 — ABV numeric parse, 27 CFR 5.65 tolerance, proof/ABV consistency | 3 unit tests + `wrong-abv` fixture |
| PRP-03 | FR-4 — net contents normalised to millilitres | 2 unit tests + `stones-throw-tilted` |
| PRP-04 | FR-5, FR-6 — warning exact-match, all-caps heading, first-diverging-word message | 5 unit tests + `title-case-warning` |
| PRP-05 | FR-11–FR-15 — three-state verdict, roll-up, uncertainty resolves to review | unit tests |
| PRP-06 | FR-21–FR-24 — image quality separated from compliance | 2 unit tests + tilted fixture |
| PRP-07 | FR-16–FR-20 — batch CSV + multi-image, concurrency 6, results export | manual, `samples/manifest.csv` |
| PRP-08 | NFR-2 — accessible UI | manual |
| PRP-09 | NFR-4 — provider errors mapped to plain language | 4 error branches curl-tested |
| PRP-10 | D-1, D-6 — public repo, Railway deploy, auto-redeploy | live URL |
| PRP-11 | Warning-heading transcription bug (found in production) | 6/6 stability run |
| PRP-12 | FR-7 code path — bold detection, three-way handling | 3 unit tests + PRP-13 artwork proof |

## Closed this round

| PRP | Title | Outcome |
|---|---|---|
| PRP-13 | Prove bold detection on real artwork | DONE — `unbolded-warning` fixture returns FAIL naming bold; `old-tom` still PASS |
| PRP-14 | Sync README to actual behaviour | DONE — claims re-verified against source by an independent agent |
| PRP-15 | Re-measure and minimise latency | DONE — no safe reduction found; call already optimally configured. Re-measured at n=10 after the OD-1 revert: median 4.44s, p90 4.95s, max 6.29s |
| PRP-16 | Report all warning defects, not the first | DONE — defects collected and reported together, +4 tests |
| PRP-17 | Validate model JSON at the boundary | DONE — `validateExtractedLabel`, 11 tests, no new dependency |
| PRP-18 | Document firewall risk and model-swap path | DONE — `docs/MIGRATION.md` |
| PRP-19 | Optional TTB fields (OD-1) | DONE — reverted; FR-8/FR-9 now OUT and documented as a known gap |

## Open

None. Remaining known gaps are recorded in the PRD (FR-10 type size, NFR-7
firewall) and in the README's limitations section, not as actionable PRPs.
