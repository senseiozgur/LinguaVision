# iOS-First System Design (Canonical)

## Goal
PDF cevirisinde format bozulmasini minimumda tutan, maliyet kontrollu, fallback-guvenli ve iOS-first bir sistem.

## Canonical Dependencies
- Routing/cost karar kaynagi: `research/router_policy.md`
- Sadece bu dosya + `research/router_policy.md` mimari kanonik kaynaktir.

## Mode-B Current Status (2026-03-10)
- Branch: `feature/modeb-groq-first-google-deepl`
- Latest verified checkpoint: `69375a9` (`fix(pdf): stabilize bbox-aware fit flow for readable mode-b output`)
- Mode-B extraction/rendering line materially improved on real sample (`backend/ornek.pdf`) with sidecar-first extraction and renderer tuning.
- Current integration direction is BabelDOC external engine path for Mode-B output generation; custom renderer remains rollback fallback.
- External runtime contract now explicitly includes:
  - `LV_BABELDOC_CA_BUNDLE`
  - `LV_BABELDOC_INSECURE_TLS` (default `0`, temporary VPN workaround only)
  - `LV_BABELDOC_ALLOW_SOURCE_FALLBACK_ON_REPETITION` (default `0`)
  - `LV_PDF_ENGINE_REQUIRED_PYTHON` (default `3.12`)
  - `LV_PDF_ENGINE_RUNTIME_TIMEOUT_MS` (runtime probe timeout)
  - `LV_MODE_B_ENGINE_MAX_CONCURRENCY` (external engine concurrency ceiling)
- Mode-B external execution now emits deterministic runtime/attempt events:
  - `ENGINE_RUNTIME_VALIDATED` / `ENGINE_RUNTIME_INVALID`
  - `PROVIDER_ATTEMPT_STARTED` / `PROVIDER_ATTEMPT_FINISHED`
  - `ENGINE_SELECTED` includes resolved order, exclusions, and selection reason
- Output readability is significantly better than early fallback/text-wall outputs, but still below full natural-document reconstruction on hard PDFs.

### Verified Mode-B Milestone Chain (Substance)
- `2e05a46`: PyMuPDF sidecar extraction boundary added.
- `dbc0a78`: extraction ordering and noise suppression improved.
- `7c0ec47`: UTF-8 sidecar IO cleanup.
- `06cfeab`: body-focused extraction and layout mapping fidelity improved.
- `9dd641c`: paragraph reconstruction heuristics refined.
- `7155fff`: role-based block rendering improved readability.
- `83b731a`: heading/body transition and paragraph typography refinement.
- `f039bab`: long body block rhythm softened.
- `15ad352`: overflow/page-fit compaction improved.
- `69375a9`: bbox-aware fit flow stabilized with measurable readability gain.

### Honest Quality Boundary
- Fully verified now:
  - real body-text extraction path is active (fallback path no longer primary in normal sidecar mode)
  - Mode-B output generation is operational for current test corpus
  - BabelDOC external path wiring and runtime controls are integrated in backend
  - production semantics no longer allow MODE-A silent source-PDF success when credentials are missing
  - jobs that enter `PROCESSING` are forced to terminal `READY|FAILED` on charge/provider failures
- Improved but imperfect:
  - advanced natural document feel (high-end typography and nuanced page composition)
  - full layout fidelity on complex/edge-case PDFs
  - repetition handling behavior is under active hardening; do not treat as fully closed yet
- Future work:
  - stabilize external BabelDOC translation semantics under constrained network/VPN environments
  - broader real-document benchmark corpus and quality gating

### Runtime Guardrails (P0/P1)
- `remaining_units` client field is ignored for admission decisions; server-side policy is authoritative.
- Simulation query flags on `/jobs/:id/run` are blocked by default and require `LV_ENABLE_SIMULATION_FLAGS=1`.
- Billing error code mapping includes `BILLING_DAILY_CAP_EXCEEDED` for server-side cap denial paths.

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

### LV-20 Status
- Production readiness summary published (`research/production_readiness.md`).
- Handover pack published (`research/handover_pack.md`).
- Production/handover guard test added (`scripts/production_handover.test.mjs`).

### LV-21 Status
- Post-release monitoring cadence published (`research/monitoring_cadence.md`).
- Incident response template published (`research/incident_template.md`).
- Post-release ops guard test added (`scripts/post_release_ops.test.mjs`).

### LV-22 Status
- Staging smoke run checklist published (`research/staging_smoke_run.md`).
- Minimal staging smoke API contract test added (`scripts/staging_smoke.test.mjs`).

### LV-23 Status
- Supabase billing migration drafted for append-only ledger + idempotent RPCs (`supabase/migrations/20260304170000_billing_ledger.sql`).
- Backend billing adapters added (`backend/src/billing/*`) and run flow wired for deterministic charge/refund.
- Billing reliability test added (`scripts/billing_reliability.test.mjs`).

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
