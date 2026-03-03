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

## Active Sprint (2-min Blocks)
- [x] Contract freeze table added to `research/router_policy.md`.
- [x] C (implementation scaffold) tamamlandi.
- [x] D (cost controls first) admission + runtime guard seviyesine indirildi.
- [x] E (provider adapters + deterministic fallback chain) tamamlandi.
- [x] F (iOS integration pass create/run/poll/download) contract+flow test seviyesinde tamamlandi.
- [x] Next: G (provider adapter integration test depth + iOS polling scenario coverage).

## New Pending
- [x] Add Supabase MCP server definition (project-level config) and validate connection flow.

## Cadence Watch
- [x] Heartbeat protocol synced in `chat/chat.md`.
- [x] 60s chat watcher script added (`scripts/chat_heartbeat.ps1`).
- [x] Runtime usage: keep watcher running during active implementation windows.

## Progress Update
- [x] E adimi tamamlandi: provider adapter + deterministic fallback chain wiring (`backend/src/providers/*`, `backend/src/routes/jobs.routes.js`).
- [x] F adimi tamamlandi: jobs response/state uyum testleri + flow testi (`scripts/scaffold.test.mjs`, `scripts/jobs_flow.test.mjs`).

## F Step Update (Olgun)
- [x] Jobs API response/state uyum testleri `scripts/scaffold.test.mjs` icinde genisletildi.
- [x] `npm run test:scaffold` PASS.
- [x] `audit/audit-log.md` append edildi.
- [x] `npm run test:flow` PASS (POST/GET/output + cost guard + not_found).

## Idea (Simple & Useful)
- [x] Add `GET /jobs/:id/events` lightweight timeline (state changes only) for iOS debug clarity without heavy observability stack.

## G Step Update (Olgun)
- [x] Provider fallback integration depth testi: one-tier-fail->success ve all-tier-fail->FAILED.
- [x] iOS polling uyum state transition testi: PENDING->PROCESSING->READY ve FAILED+error_code.
- [x] `npm run test:scaffold` PASS.
- [x] `npm run test:flow` PASS.

## H Step Update (Olgun)
- [x] `GET /jobs/:id/events` endpoint eklendi (state timeline).
- [x] `npm run test:scaffold` PASS (events endpoint contract dahil).
- [x] `npm run test:flow` PASS (success/failure transition traces dahil).

## Coordination Guardrail
- [x] Assignment waiting kaldirildi: ajanlar backlogdan `SELF-CLAIM` ile is alir.
- [x] Next: I (async queue simulation toggles + iOS polling payload review).

## I Step Update (Olgun)
- [x] Async queue simulation toggle eklendi (`async=1`, `worker_delay_ms`).
- [x] iOS polling payload review: `selected_tier`, `last_transition_at` alanlari eklendi.
- [x] `npm run test:scaffold` PASS.
- [x] `npm run test:flow` PASS.

## I Step Update (Cevher)
- [x] Flow test derinlestirme: async failure path (PROCESSING -> FAILED + error_code + events trace).
- [x] `npm run test:flow` PASS (yeni async failure senaryosu dahil).

## J Step Update (Olgun)
- [x] In-memory `JobQueue` adapter eklendi (`backend/src/jobs/job.queue.js`).
- [x] Async run path queue uzerinden worker izolasyonuna alindi.
- [x] `npm run test:scaffold` PASS.
- [x] `npm run test:flow` PASS.

## K Step Update (Olgun)
- [x] Single-worker queue ordering testi eklendi (`scripts/jobs_flow.test.mjs`).
- [x] Async polling tutarliligi: ikinci is birinciden once `READY` olamaz.
- [x] `npm run test:scaffold` PASS.
- [x] `npm run test:flow` PASS.

## L Step Update (Olgun)
- [x] Provider error normalization sertlestirildi (`backend/src/routes/jobs.routes.js`).
- [x] Simule provider hata kodu destegi eklendi (`simulate_fail_code`).
- [x] Bilinmeyen hata kodu `PROVIDER_UPSTREAM_5XX`'e normalize ediliyor.
- [x] `npm run test:scaffold` PASS.
- [x] `npm run test:flow` PASS.

## M Step Update (Cevher)
- [x] Ayni tier icinde tek retry simulasyonu eklendi (`simulate_retry_once_tiers`).
- [x] Retry sonrasi basarili senaryoda escalation olmadan `selected_tier` korunuyor.
- [x] `npm run test:scaffold` PASS.
- [x] `npm run test:flow` PASS.
