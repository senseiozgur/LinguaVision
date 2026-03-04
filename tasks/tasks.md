# LinguaVision Task Board

## Canonical Decisions
- architecture/system_design.md
- research/router_policy.md

## Active Backlog
- [x] LV-01 Jobs route baseline hardening
- [x] LV-02 Provider adapter error normalization
- [ ] LV-03 Polling and queue ordering consistency
- [ ] LV-04 Retry policy simulation coverage
- [ ] LV-05 Audit log + docs sync

## In Progress
- [ ] LV-03 | owner=Cevher | files=backend/src/jobs/job.queue.js,scripts/jobs_flow.test.mjs | started=2026-03-04T03:47:13+03:00

## Done
- [x] INIT-00 | owner=setup | commit=none | proof=coordination files initialized
- [x] LV-01 | owner=Cevher | commit=ccbd017 | proof=npm run test:scaffold PASS; npm run test:flow PASS
- [x] LV-02 | owner=Olgun | commit=99e7fa6 | proof=node scripts/jobs_flow.test.mjs PASS