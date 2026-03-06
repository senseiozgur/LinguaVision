# Final Verification Checklist (Stage-10)

This checklist is for live proofs that may be blocked in local/dev by missing credentials or linked Supabase project.

## 1) Supabase migration apply
1. `npx supabase login`
2. `npx supabase link --project-ref movsrrbnurybokbdmkly`
3. `npx supabase db push`

Expected:
- `public.jobs`, `public.job_events`, `public.billing_ledger`, `public.user_balance`
- `public.rate_limit_windows`
- RPCs: `rpc_charge_units`, `rpc_refund_units`, `rpc_claim_next_queued_job`, `rpc_claim_next_refund_retry_job`, `rpc_rate_limit_check`

## 2) DeepL live proof (Mode-A)
1. Set envs:
- `DEEPL_API_KEY`
- `LV_PROVIDER_MODE_A_ORDER=deepl,google`
2. Run backend and worker.
3. Submit PDF with `provider_mode=mode_a`.
4. Verify:
- `provider_used=deepl`
- output downloadable
- no Mode-B events

## 3) Google live proof (Mode-A)
1. Set envs:
- `GOOGLE_PROJECT_ID`
- `GOOGLE_APPLICATION_CREDENTIALS` or `GOOGLE_SERVICE_ACCOUNT_JSON`
- `LV_PROVIDER_MODE_A_ORDER=google,deepl`
2. Submit PDF with `provider_mode=mode_a`.
3. Verify:
- `provider_used=google`
- output downloadable

## 4) OpenAI / Groq live proof (Mode-B)
1. Set envs:
- `OPENAI_API_KEY`
- `GROQ_API_KEY`
- `LV_MODE_B_PROVIDER_ORDER=openai,groq`
2. Submit PDF with `provider_mode=mode_b`.
3. Verify events:
- `MODE_B_SELECTED`
- `TEXT_EXTRACTION_DONE`
- `TEXT_CHUNKING_DONE`
- `LLM_TRANSLATION_SUCCEEDED`
- `MODE_B_LAYOUT_DONE`
- `MODE_B_OUTPUT_GENERATED`

## 5) Distributed claim proof (2 workers)
1. Run API with `LV_DISABLE_EMBEDDED_WORKER=1`.
2. Run two worker processes with different `LV_WORKER_ID`.
3. Enqueue multiple jobs.
4. Verify each job gets one claim and no double processing.

## 6) Storage live proof
1. Set `LV_STORAGE_PROVIDER=supabase`.
2. Verify input and output objects in buckets:
- `pdf-input`
- `pdf-output`
3. Verify `/jobs/:id/output` still serves from backend with owner isolation.

## 7) Shared rate-limit proof
1. Ensure migration with `rpc_rate_limit_check` is applied.
2. Set `LV_RATE_LIMIT_SHARED=1`.
3. Hit endpoints past limits.
4. Verify `/jobs/metrics` shows:
- `rate_limit_mode=shared` (or `memory_fallback` if RPC missing)
- incrementing `rate_limit_shared_hits_total`.

## 8) Metrics endpoint hardening proof
1. Set:
- `LV_ENABLE_METRICS=1`
- `LV_METRICS_API_KEY=<internal-key>`
- `LV_METRICS_ALLOW_PRIMARY_KEY=0`
2. Verify:
- without `x-metrics-key` => `401`
- with `x-metrics-key` => `200`

## 9) Retention cleanup command proof
1. Create old files under `backend/storage-data/input` and `backend/storage-data/output`.
2. Run `node scripts/retention_cleanup.mjs`.
3. Verify summary counters and deleted old artifacts.
