# Final Risk Register (LV-19)

## R1: Layout Fidelity Drift in Real PDFs
- Severity: High
- Likelihood: Medium
- Mitigation:
  - strict quality gate (`LAYOUT_QUALITY_GATE_BLOCK`)
  - layout metrics in polling payload
  - fallback UX hint for readable mode
- Evidence: `backend/src/routes/jobs.routes.js`, `backend/src/pdf/layout.pipeline.js`

## R2: Provider Timeout/Outage Spikes
- Severity: High
- Likelihood: Medium
- Mitigation:
  - deterministic fallback chain + retry counters
  - timeout tuning knobs (`simulate_provider_latency_ms`, `provider_timeout_ms`)
  - outage UX mapping (`ux_hint=retry_or_fallback`)
- Evidence: `backend/src/routes/jobs.routes.js`, `scripts/jobs_flow.test.mjs`

## R3: Cost Overrun in Long Jobs
- Severity: High
- Likelihood: Low-Medium
- Mitigation:
  - admission guard (`COST_GUARD_BLOCK`)
  - runtime guard (`COST_LIMIT_STOP`)
  - package enforcement matrix regression checks
- Evidence: `backend/src/routing/cost.guard.js`, `scripts/jobs_flow.test.mjs`

## R4: Cache Memory/Storage Pressure
- Severity: Medium
- Likelihood: Medium
- Mitigation:
  - bounded LRU cache + optional persistence
  - rollback toggle (`DISABLE_TRANSLATION_CACHE`)
- Evidence: `backend/src/providers/translation.cache.js`, `backend/src/server.js`

## R5: Contract Drift Between Backend and iOS
- Severity: High
- Likelihood: Low
- Mitigation:
  - frozen contract snapshot
  - compatibility guard tests
  - migration notes fixture
- Evidence: `research/ios_contract_snapshot.json`, `scripts/ios_contract_compat.test.mjs`, `research/ios_migration_notes.md`
