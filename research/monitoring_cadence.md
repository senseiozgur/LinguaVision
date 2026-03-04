# Post-Release Monitoring Cadence (LV-21)

## Cadence Windows
- 0-24 hours: every 15 minutes
- Day 2-7: every 2 hours
- Week 2-4: twice daily
- Steady state: daily summary + weekly trend review

## Mandatory Metrics (`GET /jobs/metrics`)
- Throughput: `jobs_create_total`, `jobs_run_total`, `jobs_ready_total`, `jobs_failed_total`
- Reliability: `provider_retry_total`, `provider_fallback_total`, `runtime_guard_block_total`
- Provider perf: `provider_calls_total`, `provider_success_total`, `provider_fail_total`, `provider_latency_avg_ms`
- Cache health: `cache_hits_total`, `cache_misses_total`, `cache_evictions_total`, `cache_entries`
- Feature flags: `feature_disable_layout_pipeline`, `feature_disable_translation_cache`, `feature_disable_strict_quality_gate`

## Alert Thresholds (Initial)
- `jobs_failed_total / jobs_run_total > 5%` over 1h
- `provider_latency_avg_ms > 2000` over 30m
- `provider_fallback_total` spike > 3x daily baseline
- `runtime_guard_block_total` spike > 2x weekly baseline
- `cache_evictions_total` sustained growth with high miss ratio (>70%)

## Escalation
1. On-call checks feature flags and recent deploy diff.
2. If user impact ongoing, apply rollback toggles from reliability playbook.
3. Open incident record using `research/incident_template.md`.
4. After stabilization, run post-incident action tracking.

## Evidence
- Metrics source: `backend/src/routes/jobs.routes.js`
- Toggle source: `backend/src/server.js`
- Reliability reference: `research/reliability_playbook.md`
