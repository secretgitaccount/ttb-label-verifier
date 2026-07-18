# PRP-16 — Report all warning defects, not just the first

**Requirement:** FR-5, FR-7 · **Priority:** P2 · **Blocks submission:** no

## Problem
In `compareWarning` (`lib/compare.ts`), `headingBold === false` is checked before
`!check.textExact`. A label with BOTH altered wording and a light heading reports
only the bold defect. The verdict is FAIL either way, so this is a reporting
defect, not a verdict defect — but an agent sends the applicant an incomplete
correction and gets a second bad submission back.

## Scope
Own: `lib/compare.ts`, `test/compare.test.ts`. Nothing else.

## Do
1. Collect warning defects rather than returning on the first match: wording,
   caps, bold.
2. Report all of them in the reason, most severe first.
3. Preserve existing precedence for the VERDICT: any hard defect is FAIL;
   uncertain bold alone remains REVIEW; uncertain bold plus a wording defect
   remains FAIL.
4. Add a test for a label with two simultaneous defects asserting both appear.

## Acceptance criteria
- All 26 existing tests still pass
- A two-defect label names both defects
- Verdict semantics unchanged for every existing case
