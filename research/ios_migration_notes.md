# iOS Migration Notes (LV-17)

## Objective
Move iOS client integration to the current LinguaVision contract without breaking polling UX.

## Endpoints
1. `POST /jobs`
- Request: multipart `file`, `target_lang`, optional `source_lang`, `package`, `mode`, `remaining_units`
- Response: `{ job_id, status }`

2. `POST /jobs/{id}/run`
- Response: `{ accepted, job_id, status, idempotent? }`
- Behavior:
  - `PENDING` -> starts processing
  - `PROCESSING|READY` -> idempotent response (`idempotent=true`)

3. `GET /jobs/{id}`
- Polling payload:
  - `status`, `progress_pct`, `error_code`
  - `selected_tier`, `layout_metrics`, `translation_cache_hit`
  - `quality_gate_passed`, `quality_gate_reason`, `cost_delta_units`
  - `ux_hint`, `last_transition_at`, `billing`

4. `GET /jobs/{id}/events`
- Timeline for state transitions (`PENDING/PROCESSING/READY/FAILED`).

5. `GET /jobs/{id}/output`
- PDF bytes when status is `READY`.

6. `GET /jobs/metrics`
- Operational counters and feature flags for diagnostics.

## iOS Error UX Mapping
- `PROVIDER_*` -> retry/fallback banner
- `COST_GUARD_BLOCK` -> budget exceeded prompt
- `LAYOUT_QUALITY_GATE_BLOCK` -> suggest readable mode

## Migration Checklist
- Replace hard-coded old response parsing with current payload keys.
- Use `idempotent` on run retries to avoid duplicate UX errors.
- Render `ux_hint` in failure state CTA.
- Keep polling interval adaptive (faster on PROCESSING, slower otherwise).
- Gate debug-only metrics screen behind internal flag.

## Evidence
- Contract source: `research/ios_contract_snapshot.json`
- Runtime route source: `backend/src/routes/jobs.routes.js`
- Canonical architecture: `architecture/system_design.md`
