# Handover Pack (LV-20)

## Canonical Sources
- `architecture/system_design.md`
- `research/router_policy.md`

## Core Runtime Files
- `backend/src/routes/jobs.routes.js`
- `backend/src/providers/provider.adapter.js`
- `backend/src/providers/translation.cache.js`
- `backend/src/routing/cost.guard.js`
- `backend/src/pdf/layout.pipeline.js`
- `backend/src/jobs/job.queue.js`
- `backend/src/server.js`

## Research/Decision Files
- `research/comparison.md`
- `research/cost_strategy.md`
- `research/reliability_playbook.md`
- `research/ios_contract_snapshot.json`
- `research/ios_migration_notes.md`
- `research/benchmark_baseline.md`
- `research/release_hardening.md`
- `research/risk_register.md`
- `research/production_readiness.md`

## Test Suite Entry Points
- `npm run test:scaffold`
- `npm run test:flow`
- `npm run test:audit-compact`
- `npm run test:ios-contract`
- `npm run test:ios-migration`
- `npm run test:benchmark-mode`
- `npm run test:release-hardening`

## Handover Checklist
- Pull latest `main`
- Run full test suite above
- Confirm `/jobs/metrics` includes cache + provider + feature flags
- Confirm iOS contract snapshot compatibility test is PASS
- Review reliability playbook before staging rollout

## Ownership Note
- Single-agent mode (Cevher) used during build-out.
- Coordination logs: `chat/chat.md`, `chat/handoff.md`, `tasks/tasks.md`.
