# LinguaVision Task Board (Single Agent)

## Canonical Decisions
- architecture/system_design.md
- research/router_policy.md

## Operating Mode
- Mode: SINGLE_AGENT (Cevher)
- Coordination artifacts remain for traceability: `chat/chat.md`, `chat/handoff.md`.
- Baton flow disabled; `chat/handoff.md` acts as checkpoint/recovery ledger.

## Completed
- [x] LV-01 Jobs route baseline hardening
  proof: `backend/src/routes/jobs.routes.js`, `scripts/jobs_flow.test.mjs`, commit `ccbd017`
- [x] LV-02 Provider adapter error normalization
  proof: `backend/src/providers/provider.adapter.js`, commit `99e7fa6`
- [x] LV-03 Polling and queue ordering consistency
  proof: `backend/src/jobs/job.queue.js`, `scripts/jobs_flow.test.mjs` (single-worker ordering test)
- [x] LV-04 Retry policy simulation coverage
  proof: `backend/src/routes/jobs.routes.js`, `scripts/jobs_flow.test.mjs` (`simulate_retry_once_tiers`)
- [x] LV-05 Audit log + docs sync
  proof: `audit/audit-log.md`, `architecture/system_design.md`, `chat/chat.md`, `chat/handoff.md`

## Current Focus
- [x] LV-06 PDF layout-preserving translation architecture (implementation-ready slice)
- [x] LV-07 iOS contract hardening + idempotency/observability minimal set
- [x] LV-08 PDF layout quality metrics and cache keying hardening
- [x] LV-09 cache persistence strategy + eviction policy
- [x] LV-10 provider retry/fallback telemetry and audit compaction
- [x] LV-11 strict/readable processing quality gates and cost-delta exposure
- [x] LV-12 provider outage simulation matrix and iOS UX mapping hardening
- [x] LV-13 iOS-facing contract snapshot docs and compatibility guard tests
- [x] LV-14 provider performance baselines and timeout policy tuning
- [x] LV-15 lightweight reliability playbook and rollback toggles
- [x] LV-16 cost-package enforcement regression matrix
- [x] LV-17 iOS client integration fixture and migration notes
- [x] LV-18 strict/readable performance benchmark baselines
- [x] LV-19 release hardening checklist and final risk register
- [x] LV-20 production readiness summary and handover pack
- [x] LV-21 post-release monitoring cadence + incident template
- [x] LV-22 staging release checklist + smoke run
- [x] LV-23 Supabase billing ledger + deterministic charge/refund integration

## Auto Loop (No Human Wait)
1. Pick next top task.
2. Implement minimal slice.
3. Run proof command(s) and record output.
4. Update `chat/chat.md` in `TASK/OUTPUT/PROOF/NEXT` format.
5. Commit changed files.
6. `git pull --rebase origin main`.
7. `git push origin main`.

## Latest Progress
- [x] LV-06.1 layout pipeline (parse->anchor->chunk->reflow) minimal implementation landed.
  evidence: `backend/src/pdf/layout.pipeline.js`, `backend/src/providers/provider.adapter.js`, `backend/src/routes/jobs.routes.js`
- [x] Jobs response now exposes `layout_metrics` for polling/debug visibility.
  evidence: `backend/src/routes/jobs.routes.js`, `backend/src/jobs/job.store.js`
- [x] LV-07 idempotent run semantics and lightweight metrics endpoint landed.
  evidence: `backend/src/routes/jobs.routes.js`, `scripts/jobs_flow.test.mjs`, `scripts/scaffold.test.mjs`
- [x] LV-08 deterministic translation cache and cache-hit visibility landed.
  evidence: `backend/src/providers/provider.adapter.js`, `backend/src/routes/jobs.routes.js`, `scripts/jobs_flow.test.mjs`
- [x] LV-09 bounded LRU eviction + optional persisted translation cache landed.
  evidence: `backend/src/providers/translation.cache.js`, `backend/src/providers/provider.adapter.js`, `backend/src/server.js`, `backend/src/routes/jobs.routes.js`
- [x] LV-10 telemetry counters and audit compaction script landed.
  evidence: `backend/src/routes/jobs.routes.js`, `scripts/jobs_flow.test.mjs`, `scripts/audit_compact.mjs`, `backend/package.json`
- [x] LV-11 strict quality gate and cost-delta visibility landed.
  evidence: `backend/src/routes/jobs.routes.js`, `backend/src/jobs/job.store.js`, `scripts/jobs_flow.test.mjs`, `scripts/scaffold.test.mjs`
- [x] LV-12 outage simulation matrix + ux_hint mapping hardening landed.
  evidence: `backend/src/routes/jobs.routes.js`, `scripts/jobs_flow.test.mjs`, `research/router_policy.md`
- [x] LV-13 iOS contract snapshot + compatibility guard test landed.
  evidence: `research/ios_contract_snapshot.json`, `scripts/ios_contract_compat.test.mjs`, `backend/package.json`
- [x] LV-14 provider perf counters + timeout tuning knobs landed.
  evidence: `backend/src/providers/provider.adapter.js`, `backend/src/routes/jobs.routes.js`, `scripts/jobs_flow.test.mjs`
- [x] LV-15 rollback toggles + reliability playbook landed.
  evidence: `backend/src/server.js`, `backend/src/routes/jobs.routes.js`, `research/reliability_playbook.md`
- [x] LV-16 package enforcement regression matrix landed.
  evidence: `backend/src/routes/jobs.routes.js`, `scripts/jobs_flow.test.mjs`, `scripts/scaffold.test.mjs`
- [x] LV-17 iOS migration notes and guard test landed.
  evidence: `research/ios_migration_notes.md`, `scripts/ios_migration_notes.test.mjs`, `backend/package.json`
- [x] LV-18 strict/readable benchmark baseline landed.
  evidence: `scripts/benchmark_mode_baseline.mjs`, `research/benchmark_baseline.md`, `backend/package.json`
- [x] LV-19 release hardening checklist + risk register landed.
  evidence: `research/release_hardening.md`, `research/risk_register.md`, `scripts/release_hardening.test.mjs`
- [x] LV-20 production readiness summary + handover pack landed.
  evidence: `research/production_readiness.md`, `research/handover_pack.md`, `scripts/production_handover.test.mjs`
- [x] LV-21 post-release monitoring cadence + incident template landed.
  evidence: `research/monitoring_cadence.md`, `research/incident_template.md`, `scripts/post_release_ops.test.mjs`
- [x] LV-22 staging smoke checklist + automated smoke test landed.
  evidence: `research/staging_smoke_run.md`, `scripts/staging_smoke.test.mjs`, `backend/package.json`
- [x] LV-23 supabase-backed billing adapter and reliability tests landed.
  evidence: `supabase/migrations/20260304170000_billing_ledger.sql`, `backend/src/billing/billing.supabase.js`, `backend/src/routes/jobs.routes.js`, `scripts/billing_reliability.test.mjs`
