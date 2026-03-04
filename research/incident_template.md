# Incident Response Template (LV-21)

## Incident Header
- Incident ID:
- Opened At (ISO8601):
- Detected By (alert/manual):
- Severity (SEV-1/SEV-2/SEV-3):
- Status (OPEN/MONITORING/RESOLVED):

## Impact Summary
- User Impact:
- Affected Packages (Free/Pro/Premium):
- Affected Endpoints:
- Start Time:
- End Time (if resolved):

## Detection and Signals
- Triggered Alert:
- `/jobs/metrics` snapshot:
  - `jobs_failed_total`:
  - `jobs_run_total`:
  - `provider_fallback_total`:
  - `provider_latency_avg_ms`:
  - `runtime_guard_block_total`:
- Related Feature Flags:
  - `feature_disable_layout_pipeline`:
  - `feature_disable_translation_cache`:
  - `feature_disable_strict_quality_gate`:

## Timeline (UTC+3)
1. Detection:
2. First triage action:
3. Mitigation:
4. Stabilization:
5. Resolution:

## Root Cause Analysis
- Immediate Cause:
- Contributing Factors:
- Why not detected earlier:

## Mitigation and Recovery
- Temporary Mitigation:
- Permanent Fix:
- Rollback toggle used (if any):
- Verification commands:

## Customer Communication
- Public/Internal message:
- ETA shared:
- Follow-up channel:

## Action Items
- [ ] Engineering:
- [ ] Product/Ops:
- [ ] Monitoring/Alert tuning:
- [ ] Documentation update:

## Evidence Links
- Metrics source: `backend/src/routes/jobs.routes.js`
- Toggle source: `backend/src/server.js`
- Playbook: `research/reliability_playbook.md`
- Monitoring cadence: `research/monitoring_cadence.md`
