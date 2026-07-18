# PRP-14 — Sync README to actual behaviour

**Requirement:** D-7 · **Priority:** P0 · **Blocks submission:** yes

## Problem
The library gained three user-visible behaviours this session; the README
documents none. `grep -i 'bold\|bottler\|country of origin' README.md` returns
nothing. A reviewer reads documentation for software that does not exist.

## Scope
Own: `README.md` only. Read `lib/` to verify claims; never edit it.

## Do
1. Read `lib/compare.ts` and `lib/extract.ts` as they exist NOW. Do not rely on
   this file's description of them.
2. Document in "What each field checks": the warning is checked for exact text,
   all-caps heading, AND bold heading.
3. Document the new REVIEW path — a fully-matching label returns "Check" when
   heading weight cannot be determined from the image. This changes what an agent
   sees and is currently undocumented.
4. Update the verdicts table if the meaning of "Check" has widened.
5. Fix the incorrect citation: the "results assist review" footer text lives in
   `app/layout.tsx`, not `components/Verdict.tsx`.
6. Reconcile the optional-fields state with whatever `lib/types.ts` shows. If
   they are present but unreachable from the UI and CSV importer, say exactly
   that. Do not describe them as features.

## Acceptance criteria
- Every behaviour in `lib/compare.ts` that changes a user-visible verdict is documented
- No claim in the README is unsupported by code you have read
- Known gaps are stated, not omitted
- Existing voice preserved: direct, specific, no marketing language

## Report
Which claims you verified against which files, and anything you found in the
README that was already wrong.
