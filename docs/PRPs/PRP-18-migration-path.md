# PRP-18 — Document firewall risk and model-swap path

**Requirement:** NFR-7 · **Priority:** P1 · **Blocks submission:** no

## Problem
Marcus Williams said TTB's network blocks outbound traffic to many domains and
that the previous vendor's ML endpoints were firewall-blocked. This app calls
api.anthropic.com on every request. Behind that firewall it fails exactly as the
vendor did. The README does not mention this at all.

## Scope
Own: a new `docs/MIGRATION.md`, plus a short pointer added to `README.md`.
COORDINATION: PRP-14 also edits README.md. Add only a brief linked section and
keep it separate from the sections PRP-14 rewrites.

## Do
Document honestly:
1. The risk: a cloud API call per request, and why that reproduces the vendor failure.
2. Why the architecture already anticipates it: `lib/extract.ts` is the only file
   that touches a model, holds no compliance logic, and returns the
   `ExtractedLabel` type. Swapping it leaves `compare.ts`, every test, and every
   verdict untouched.
3. Realistic options, with honest costs:
   - **Azure AI Document Intelligence / Computer Vision** — strongest path. TTB
     migrated to Azure in 2019 and has cleared FedRAMP for it, so it is far more
     likely to pass their firewall than a third-party ML endpoint.
   - **Self-hosted vision model (Qwen2-VL, Llama 3.2 Vision) on GPU** — viable
     inside their network; needs GPU hardware, and accuracy on exact
     character-level transcription must be validated before trust.
   - **Traditional OCR (Tesseract, PaddleOCR)** — no ML endpoint, CPU-only, but
     weak on stylised type, curved glass, and angled shots, which is most of the
     hard cases here.
4. State plainly what does NOT work: a general orchestration framework such as
   LangChain does not remove the network call — it wraps a provider, it is not a
   model. And CPU inference of a vision model reproduces the 30–40s latency that
   made agents abandon the last vendor.
5. Note that exact-match warning checking amplifies transcription error: a weaker
   model produces false verdicts, and agents stop trusting the tool.

## Acceptance criteria
- Risk stated without minimising it
- Swap path concrete enough to cost out
- No option oversold; costs stated alongside benefits
