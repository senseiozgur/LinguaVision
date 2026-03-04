# Release Hardening Checklist (LV-19)

## Contract
- [x] iOS contract snapshot up-to-date (`research/ios_contract_snapshot.json`)
- [x] Contract guard tests green (`test:ios-contract`, `test:ios-migration`)

## Runtime Stability
- [x] Queue ordering and async polling checks green (`test:flow`)
- [x] Strict quality gate and ux_hint mapping checks green
- [x] Rollback toggles wired and visible in `/jobs/metrics`

## Cost/Policy
- [x] Package enforcement matrix green (free strict deny, size boundaries)
- [x] Cost guard admission + runtime checks green

## Performance Baseline
- [x] strict/readable benchmark baseline recorded (`research/benchmark_baseline.md`)
- [x] provider timeout tuning knobs validated

## Operations
- [x] Audit compact summary script available (`test:audit-compact`)
- [x] Reliability playbook published (`research/reliability_playbook.md`)

## Release Gate
- [x] `npm run test:scaffold`
- [x] `npm run test:flow`
- [x] `npm run test:audit-compact`
- [x] `npm run test:ios-contract`
- [x] `npm run test:ios-migration`
- [x] `npm run test:benchmark-mode`
