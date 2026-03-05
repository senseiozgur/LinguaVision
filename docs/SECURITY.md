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

## Upload Limits
- Multer memory upload limit: `LV_MAX_UPLOAD_BYTES` (default `15728640`, 15MB)
- Oversize response: `413 {"error":"payload_too_large"}`
