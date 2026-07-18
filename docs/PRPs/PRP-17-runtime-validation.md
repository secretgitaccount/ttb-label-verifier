# PRP-17 — Validate model JSON at the boundary

**Requirement:** NFR-5 · **Priority:** P2 · **Blocks submission:** no

## Problem
`lib/extract.ts` ends with `JSON.parse(text) as ExtractedLabel` — an unchecked
cast. Structured outputs make malformed responses unlikely, not impossible. A
missing field would surface as a confusing downstream error rather than a clear
one, and the compliance path would run on data nobody validated.

## Scope
Own: `lib/extract.ts`, and a new `test/extract.test.ts` if useful.
Do not add a validation library — this is one function.

## Do
1. Write a narrow validator that checks the parsed object has the expected shape
   and types, including the nested `governmentWarning` and `imageQuality`.
2. On failure, throw an Error whose message is already user-appropriate — it
   surfaces through `describeFailure` in `route.ts`.
3. Treat a missing `headingBold` as `null` (the uncertain path), not as an error.
4. Unit-test the validator against a valid payload and several malformed ones.
   No API calls needed.

## Acceptance criteria
- A malformed response produces a clear error, not a downstream crash
- Valid payloads pass unchanged
- No new dependency
