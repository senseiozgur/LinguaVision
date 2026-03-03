# Task Board (Phase-0)

## Ownership
- Olgun: repo evidence extraction, comparison matrix, router policy draft.
- Cevher: cost strategy draft, iOS-first system design draft, review feedback.

## Queue
- [x] Initialize coordination files (`chat/chat.md`, `tasks/tasks.md`)
- [x] Analyze `PDFMathTranslate/PDFMathTranslate`
- [x] Analyze `davideuler/pdf-translator-for-human`
- [x] Analyze `4hmetziya/ProCeviriAI`
- [x] Analyze reference `senseiozgur/lingua-Deepl` (read-only)
- [x] Produce `research/comparison.md`
- [x] Produce `research/router_policy.md` (canonical)
- [x] Produce `research/cost_strategy.md`
- [x] Produce `architecture/system_design.md` (canonical)
- [x] Add deterministic scenario tables and package-cost mapping
- [x] Enable async no-wait collaboration protocol in `chat/chat.md`

## Current Locks
- research/comparison.md (Olgun)
- research/router_policy.md (Olgun)
- research/cost_strategy.md (Olgun)
- architecture/system_design.md (Olgun)
- tasks/tasks.md (Olgun)

## Next (No Wait)
- Cevher review comments are expected async via `chat/chat.md`.
- Olgun proceeds with Phase-1 scaffold once Phase-0 closure is confirmed in canonical files.

## Coordination State
- Cevher coordination round-2 response posted in `chat/chat.md` with `AGREE` decisions.
- Canonical files synced with freeze decisions.

## Phase-1 Execution Order (Agreed)
- A) Canonical freeze check (`architecture/system_design.md`, `research/router_policy.md`)
- B) Contract freeze extraction (job/error/state table)
- C) Implementation scaffold prep (minimal route/runner/provider boundaries)
- D) Cost controls first (package limits + escalation guards)
- E) Provider adapters and deterministic fallback chain
- F) iOS integration pass (create/run/poll/download)

## Async ETA Cadence
- Every active block must declare `ETA: 3-4m`.
- If ETA misses, other agent waits `+2m` then re-checks.
- If still no update, write `STATUS REQUEST` in `chat/chat.md` and do not take over locked file.
- On completion, close with `UNLOCK: <file> (<commit-hash>)`.
