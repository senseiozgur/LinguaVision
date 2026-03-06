# Observability (v1)

## Request Correlation
- Incoming `x-request-id` is reused when present.
- If missing, backend generates UUID and returns it in response header `x-request-id`.

## Structured Request Logs
- One JSON log line is emitted at request completion.
- Fields:
- `request_id`
- `method`
- `path`
- `status`
- `job_id` (when available)
- `billing_request_id` (when available)
- `duration_ms`

Example:
- `{"request_id":"...","method":"GET","path":"/jobs/job_1","status":200,"job_id":"job_1","billing_request_id":"bill_...","duration_ms":12}`

## Secret Handling
- API keys are never logged.

## Metrics Hardening + Ops Signals
- `/jobs/metrics` includes hardening/runtime fields:
- `rate_limit_mode`
- `rate_limit_shared_errors_total`
- `rate_limit_shared_hits_total`
- `rate_limit_memory_hits_total`
- `output_cache_entries`
- `output_cache_hits_total`
- `output_cache_misses_total`
- `output_cache_evictions_total`
- `output_cache_persist_enabled`

## Retention / Cleanup Notes
- Storage retention is not automatic by default.
- Local mode can be cleaned manually with:
- `node scripts/retention_cleanup.mjs`
- Optional env knobs for cleanup command:
- `RETENTION_INPUT_DAYS` (default `7`)
- `RETENTION_OUTPUT_DAYS` (default `30`)
- `RETENTION_CACHE_DAYS` (default `30`)
