# iOS-First System Design (Canonical)

## Goal
PDF cevirisinde format bozulmasini minimumda tutan, maliyet kontrollu, fallback-guvenli ve iOS-first bir sistem.

## Canonical Dependencies
- Routing/cost karar kaynagi: `research/router_policy.md`
- Sadece bu dosya + `research/router_policy.md` mimari kanonik kaynaktir.

## Current Implemented Baseline (2026-03-04)
- Jobs API: `POST /jobs`, `POST /jobs/:id/run`, `GET /jobs/:id`, `GET /jobs/:id/events`, `GET /jobs/:id/output`
  evidence: `backend/src/routes/jobs.routes.js`
- Queue model: single-worker in-memory queue
  evidence: `backend/src/jobs/job.queue.js`, `backend/src/server.js`
- Cost guard: admission + runtime
  evidence: `backend/src/routing/cost.guard.js`, `backend/src/routes/jobs.routes.js`
- Provider fallback + normalization + retry simulation
  evidence: `backend/src/providers/provider.router.js`, `backend/src/providers/provider.adapter.js`, `backend/src/routes/jobs.routes.js`
- Layout-preserving pipeline v1 (parse->anchor->chunk->reflow, passthrough writer)
  evidence: `backend/src/pdf/layout.pipeline.js`, `backend/src/providers/provider.adapter.js`, `backend/src/routes/jobs.routes.js`
- Lightweight observability endpoint for runtime counters
  evidence: `backend/src/routes/jobs.routes.js` (`GET /jobs/metrics`)
- End-to-end proof tests
  evidence: `scripts/scaffold.test.mjs`, `scripts/jobs_flow.test.mjs`

## Target Runtime Architecture
1. iOS App (SwiftUI)
- Upload PDF
- Create job (`POST /jobs`)
- Trigger run (`POST /jobs/{id}/run`)
- Poll (`GET /jobs/{id}` + optional `GET /jobs/{id}/events`)
- Download output (`GET /jobs/{id}/output`)

2. API Layer
- Input validation and response contract consistency
- Idempotent run semantics (same job, safe re-run response)
- Error normalization and iOS-friendly codes

3. Orchestrator
- State machine: `PENDING -> PROCESSING -> READY|FAILED`
- Route planning via canonical router policy
- Runtime cost guard on each execution step

4. Translation Core
- Provider adapter abstraction (economy/standard/premium)
- Same-tier retry (bounded) + deterministic fallback chain
- Layout-preserving pipeline (LV-06 target)

5. Storage and Artifacts
- Immutable input PDF
- Output PDF
- Page/chunk cache artifacts (planned hardening)

## LV-06 Architecture Slice (Next)
### Objective
PDF layout korumayi iyilestirmek icin mevcut dokuman-ceviri akisina parse-anchor-reflow adimlari eklemek.

### Minimal Components
- `PdfParseService`
: sayfa text bloklari, bbox, okuma sirasi cikartir.
- `AnchorMap`
: parse edilen bloklari ceviri oncesi sabit kimliklerle isaretler.
- `ChunkPlanner`
: anchor bazli chunk olusturur (`strict`/`readable`).
- `ReflowWriter`
: ceviri sonucunu anchor'lara geri yazar, satir kirilimi ve bbox toleransi uygular.

### Proposed Internal Flow
1. `Input PDF -> PdfParseService`
2. `AnchorMap + ChunkPlanner`
3. `ProviderAdapter.translate...`
4. `ReflowWriter` ile anchor bazli output
5. `Output PDF` + quality metrics (overflow count, moved block count)

### Acceptance Criteria (LV-06)
- Ayni test PDF icin output parse edilebilir olacak.
- Anchor coverage >= %99 (missing anchor yok ya da loglanmis).
- Overflow/clip count audit log'da raporlanacak.
- iOS contract degismeyecek (`create/run/poll/output` ayni kalacak).

### LV-06.1 Status
- Minimal pipeline implemented and wired into provider adapter.
- `GET /jobs/{id}` now includes `layout_metrics` for iOS/debug observability.

### LV-07 Status
- `POST /jobs/{id}/run` supports idempotent response for `PROCESSING|READY`.
- `GET /jobs/metrics` exposes minimal counters + queue visibility.

## iOS Contract (Frozen)
- `POST /jobs` -> `{ job_id, status }`
- `POST /jobs/{id}/run` -> `{ accepted, job_id, status, idempotent? }`
- `GET /jobs/{id}` -> `{ job_id, status, progress_pct, error_code, selected_tier, last_transition_at, billing }`
- `GET /jobs/{id}/events` -> `{ job_id, events[] }`
- `GET /jobs/metrics` -> `{ jobs_*_total, queue_depth, queue_busy }`
- `GET /jobs/{id}/output` -> `application/pdf`

## Simplicity Constraints
- Monolith backend devam.
- Tek queue worker modeli korunur.
- Sadece canonical policy ile routing/cost karari verilir.
- Over-engineering yok: event bus/distributed queue bu fazda yok.

## Evidence
- Current backend routes: `backend/src/routes/jobs.routes.js`
- Queue adapter: `backend/src/jobs/job.queue.js`
- Provider abstraction: `backend/src/providers/provider.adapter.js`
- Routing policy implementation side: `backend/src/providers/provider.router.js`
- Cost guard: `backend/src/routing/cost.guard.js`
- Flow/scaffold tests: `scripts/jobs_flow.test.mjs`, `scripts/scaffold.test.mjs`
- Reference baseline (read-only):
  - `D:/dev/proje/Deepl/backend/src/routes/jobs.routes.ts`
  - `D:/dev/proje/Deepl/backend/src/jobs/job.runner.ts`
  - `D:/dev/proje/Deepl/ios-client/LinguaFlowIOS/TranslateViewModel.swift`
