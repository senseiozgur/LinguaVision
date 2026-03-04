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
- [ ] LV-06 PDF layout-preserving translation architecture (implementation-ready slice)
- [ ] LV-07 iOS contract hardening + idempotency/observability minimal set

## Auto Loop (No Human Wait)
1. Pick next top task.
2. Implement minimal slice.
3. Run proof command(s) and record output.
4. Update `chat/chat.md` in `TASK/OUTPUT/PROOF/NEXT` format.
5. Commit changed files.
6. `git pull --rebase origin main`.
7. `git push origin main`.
