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
