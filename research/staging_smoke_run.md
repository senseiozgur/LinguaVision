# Staging Smoke Run Checklist (LV-22)

## Scope
- Objective: staging oncesi minimum canliya-benzer akista kritik API sozlesmesini hizli dogrulamak.
- Runtime: local backend, `DRY_RUN=1` davranisi.
- Command: `npm run test:staging-smoke` (backend dizininden).

## Smoke Assertions
1. `POST /jobs` 201 donmeli ve `job_id`, `status=PENDING` icermeli.
2. `POST /jobs/{id}/run` 202 donmeli ve `status=PROCESSING|READY` uyumlu olmali.
3. `GET /jobs/{id}` sonunda `status=READY` olmali; `selected_tier` ve `layout_metrics` dolu olmali.
4. `GET /jobs/{id}/output` `application/pdf` donmeli.
5. `GET /jobs/metrics` kritik alanlari donmeli:
   - `jobs_create_total`, `jobs_run_total`, `jobs_ready_total`
   - `provider_calls_total`, `provider_latency_avg_ms`
   - `cache_hits_total`, `cache_misses_total`

## Exit Criteria
- Script `PASS` doner.
- `audit/audit-log.md` icine timestamp ile PASS kaydi dusulur.
- Kritik bir FAIL varsa staging NO-GO olarak isaretlenir.

## Evidence
- Runtime endpoint implementation: `backend/src/routes/jobs.routes.js`
- Smoke script: `scripts/staging_smoke.test.mjs`
- Production gate refs: `research/release_hardening.md`, `research/production_readiness.md`
