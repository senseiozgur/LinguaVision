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
- Deterministic translation cache (in-memory, sha256 keying)
  evidence: `backend/src/providers/provider.adapter.js`
- Bounded LRU eviction + optional persisted cache storage
  evidence: `backend/src/providers/translation.cache.js`, `backend/src/server.js`
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

### LV-08 Status
- Provider adapter includes deterministic cache keying with in-memory cache map.
- `GET /jobs/{id}` payload includes `translation_cache_hit` for polling/debug.

### LV-09 Status
- Translation cache is now bounded (`cache_max_entries`) with LRU eviction.
- Optional persistence file is supported (`TRANSLATION_CACHE_PERSIST`, `translation-cache.json`).
- `/jobs/metrics` now surfaces cache hit/miss/eviction counters.

### LV-10 Status
- Provider retry/fallback/runtime-guard counters are tracked in route telemetry.
- Audit compaction helper script available (`scripts/audit_compact.mjs`).

### LV-11 Status
- Strict mode enforces single-tier processing and layout quality gate (`LAYOUT_QUALITY_GATE_BLOCK`).
- Job payload exposes `quality_gate_passed`, `quality_gate_reason`, and `cost_delta_units`.

### LV-12 Status
- Provider outage simulation matrix extended in flow tests (timeout/rate-limit/upstream).
- Job payload now includes `ux_hint` for iOS action guidance on failures.

### LV-13 Status
- iOS contract snapshot frozen in `research/ios_contract_snapshot.json`.
- Compatibility guard test added (`scripts/ios_contract_compat.test.mjs`).

### LV-14 Status
- Provider performance counters exposed (`provider_calls_total`, `provider_success_total`, `provider_fail_total`, `provider_latency_avg_ms`).
- Timeout policy tuning supported via run-time query knobs (`simulate_provider_latency_ms`, `provider_timeout_ms`).

### LV-15 Status
- Rollback toggles added for critical paths:
  - `DISABLE_LAYOUT_PIPELINE`
  - `DISABLE_TRANSLATION_CACHE`
  - `DISABLE_STRICT_QUALITY_GATE`
- Reliability runbook documented in `research/reliability_playbook.md`.

### LV-16 Status
- Package enforcement matrix covered in regression suite:
  - `free + strict` denied
  - `free` size cap enforced
  - `pro` size allowance validated on same input size

### LV-17 Status
- iOS migration notes published (`research/ios_migration_notes.md`).
- Migration doc guard test added (`scripts/ios_migration_notes.test.mjs`).

### LV-18 Status
- Strict/readable benchmark baseline added (`scripts/benchmark_mode_baseline.mjs`).
- Baseline report published in `research/benchmark_baseline.md`.

### LV-19 Status
- Release hardening checklist published (`research/release_hardening.md`).
- Final risk register published (`research/risk_register.md`).
- Release hardening guard test added (`scripts/release_hardening.test.mjs`).

## iOS Contract (Frozen)
- `POST /jobs` -> `{ job_id, status }`
- `POST /jobs/{id}/run` -> `{ accepted, job_id, status, idempotent? }`
- `GET /jobs/{id}` -> `{ job_id, status, progress_pct, error_code, selected_tier, layout_metrics, translation_cache_hit, quality_gate_passed, quality_gate_reason, cost_delta_units, ux_hint, last_transition_at, billing }`
- `GET /jobs/{id}/events` -> `{ job_id, events[] }`
- `GET /jobs/metrics` -> `{ jobs_*_total, jobs_ready_total, jobs_failed_total, provider_retry_total, provider_fallback_total, runtime_guard_block_total, cache_*_total, cache_entries, cache_max_entries, queue_depth, queue_busy }`
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
- Audit compaction test utility: `scripts/audit_compact.mjs`
- Reference baseline (read-only):
  - `D:/dev/proje/Deepl/backend/src/routes/jobs.routes.ts`
  - `D:/dev/proje/Deepl/backend/src/jobs/job.runner.ts`
  - `D:/dev/proje/Deepl/ios-client/LinguaFlowIOS/TranslateViewModel.swift`
