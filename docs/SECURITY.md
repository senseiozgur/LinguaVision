# Security Hardening (v1)

## API Key Authentication
- Header: `x-api-key: <LV_API_KEY>`
- `LV_API_KEY` can be a comma-separated allow-list (for example `keyA,keyB`).
- Protected endpoints:
- `POST /jobs`
- `POST /jobs/:id/run`
- `GET /jobs/:id`
- `GET /jobs/:id/events`
- `GET /jobs/:id/output`
- `GET /jobs/metrics`
- Missing/invalid key response: `401 {"error":"unauthorized"}`

## Tenant Isolation
- Job ownership is derived from the authenticated principal.
- Ownership token stored as `owner_id` (short SHA-256 prefix of API key).
- Access mismatch behavior:
- `GET /jobs/:id`
- `GET /jobs/:id/events`
- `GET /jobs/:id/output`
- `POST /jobs/:id/run`
- Response on mismatch: `404 {"error":"job_not_found"}`

## Rate Limits (in-memory)
- `POST /jobs`: `LV_RATE_LIMIT_CREATE_PER_MIN` (default `10`)
- `POST /jobs/:id/run`: `LV_RATE_LIMIT_RUN_PER_MIN` (default `30`)
- `GET /jobs/:id` / `GET /jobs/:id/events` / `GET /jobs/:id/output`: `LV_RATE_LIMIT_GET_PER_MIN` (default `120`)
- Limit response: `429 {"error":"rate_limited"}`

## Rate Limits (shared-preferred v2)
- `LV_RATE_LIMIT_SHARED=1` enables shared rate-limit path via Supabase RPC `rpc_rate_limit_check`.
- If shared RPC/table is unavailable, service falls back to memory limiter and logs:
- `rate_limit_shared_fallback reason=...`
- Runtime mode is exposed in `/jobs/metrics` as:
- `rate_limit_mode` (`shared` | `memory` | `memory_fallback`)
- `rate_limit_shared_errors_total`

## Metrics Endpoint Hardening
- `GET /jobs/metrics` now supports a dedicated internal key:
- Header: `x-metrics-key: <LV_METRICS_API_KEY>`
- Controls:
- `LV_ENABLE_METRICS` (`1` default, `0` disables endpoint with 404)
- `LV_METRICS_API_KEY` (recommended internal-only key)
- `LV_METRICS_ALLOW_PRIMARY_KEY` (`1` default for compatibility; set `0` to require dedicated metrics key)

## Upload Limits
- Multer memory upload limit: `LV_MAX_UPLOAD_BYTES` (default `15728640`, 15MB)
- Oversize response: `413 {"error":"payload_too_large"}`
