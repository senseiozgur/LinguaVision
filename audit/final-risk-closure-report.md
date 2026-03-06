# Final Risk Closure Report

## 1) Executive summary
- Maturity: internal hardening baseline reached (Stages 1-10 code paths exist).
- Production-ready parts: iOS contract and core regressions are green in existing outputs (`test:staging-smoke`, `test:flow`, `test:billing-reliability`, `test:ios-contract`), and historical PASS trend exists in [audit/audit-log.md](./audit-log.md:237) and [audit/audit-log.md](./audit-log.md:242).
- Blocked by external setup/credentials: Supabase remote apply + live provider credentials/process proofs ([docs/FINAL_VERIFICATION.md](../docs/FINAL_VERIFICATION.md:5), [docs/FINAL_VERIFICATION.md](../docs/FINAL_VERIFICATION.md:15), [docs/FINAL_VERIFICATION.md](../docs/FINAL_VERIFICATION.md:26), [docs/FINAL_VERIFICATION.md](../docs/FINAL_VERIFICATION.md:36)).

## 2) Top 10 risk closure table
| Risk | Status | Evidence | Why not fully closed (if partial/open) | What exact proof is still missing |
|---|---|---|---|---|
| In-memory job/state loss on restart | PARTIAL | Jobs schema and repo exist: [20260306130000_jobs.sql](../supabase/migrations/20260306130000_jobs.sql:3), [job.repo.js](../backend/src/jobs/job.repo.js:59) | Fallback to in-memory still possible when Supabase env unavailable: [server.js](../backend/src/server.js:44) | Remote DB-mode restart proof after `supabase db push` |
| No distributed claim / double-processing | PARTIAL | Claim RPC + repo calls: [20260306143000_atomic_claim_rpc.sql](../supabase/migrations/20260306143000_atomic_claim_rpc.sql:3), [job.repo.js](../backend/src/jobs/job.repo.js:208) | Live multi-worker run not evidenced | 2-worker claim proof ([docs/FINAL_VERIFICATION.md](../docs/FINAL_VERIFICATION.md:50)) |
| Provider integration missing | PARTIAL | Adapters wired: [provider.adapter.js](../backend/src/providers/provider.adapter.js:3), [provider.adapter.js](../backend/src/providers/provider.adapter.js:5), [provider.adapter.js](../backend/src/providers/provider.adapter.js:6) | Live credentials not proven | DeepL/Google/OpenAI/Groq live proofs |
| Mode-B layout fidelity | PARTIAL | Layout-aware path/events: [job.executor.js](../backend/src/jobs/job.executor.js:448), [job.executor.js](../backend/src/jobs/job.executor.js:486), [text.output.js](../backend/src/pdf/text.output.js:117) | Pixel-perfect fidelity not evidenced | Representative real PDF comparison set |
| Refund failure handling weakness | PARTIAL | Reconciliation schema+RPC and runtime retries: [20260306152000_billing_reconciliation.sql](../supabase/migrations/20260306152000_billing_reconciliation.sql:13), [job.executor.js](../backend/src/jobs/job.executor.js:680) | Live remote fail-after-charge drill missing | Live refund retry timeline proof |
| Rate limit process-local inconsistency | PARTIAL | Shared-preferred store + RPC migration: [rate-limit.store.js](../backend/src/security/rate-limit.store.js:38), [20260306210000_rate_limit_shared.sql](../supabase/migrations/20260306210000_rate_limit_shared.sql:35), exposed mode: [jobs.routes.js](../backend/src/routes/jobs.routes.js:371) | Fallback to memory when RPC unavailable by design | Live `rate_limit_mode=shared` proof |
| Local disk storage durability risk | PARTIAL | Supabase adapter exists + runtime selection: [supabase.storage.js](../backend/src/storage/supabase.storage.js:52), [server.js](../backend/src/server.js:53) | Local fallback remains available | Live object storage proof |
| Repeat-cost cache risk | PARTIAL | Deterministic key + cache events: [cache.key.js](../backend/src/cache/cache.key.js:23), [job.executor.js](../backend/src/jobs/job.executor.js:273), [job.executor.js](../backend/src/jobs/job.executor.js:283), [job.executor.js](../backend/src/jobs/job.executor.js:324) | Multi-instance behavior not fully evidenced | Shared deployment cache behavior proof |
| Analytics/traceability limited | PARTIAL | Job events + metrics counters: [job.repo.js](../backend/src/jobs/job.repo.js:193), [jobs.routes.js](../backend/src/routes/jobs.routes.js:313), [jobs.routes.js](../backend/src/routes/jobs.routes.js:371) | No long-horizon analytics store/reporting | No evidence found for aggregated analytics pipeline |
| `/jobs/metrics` weak exposure | CLOSED | Dedicated metrics guard + env controls: [jobs.routes.js](../backend/src/routes/jobs.routes.js:156), [jobs.routes.js](../backend/src/routes/jobs.routes.js:351), [backend/.env.example](../backend/.env.example:21), [docs/SECURITY.md](../docs/SECURITY.md:39) | N/A | Manual proof already captured: primary key 401, internal key 200 |

## 3) Stage-by-stage closure summary
- Stage 1: PARTIAL. DB-backed jobs/events added ([20260306130000_jobs.sql](../supabase/migrations/20260306130000_jobs.sql:3), [job.repo.js](../backend/src/jobs/job.repo.js:59)).
- Stage 2: PARTIAL. Worker split exists ([backend/src/worker.js](../backend/src/worker.js:1)).
- Stage 3: PARTIAL. Atomic claim RPC exists ([20260306143000_atomic_claim_rpc.sql](../supabase/migrations/20260306143000_atomic_claim_rpc.sql:3)).
- Stage 4: PARTIAL. Billing reconciliation flow exists ([20260306152000_billing_reconciliation.sql](../supabase/migrations/20260306152000_billing_reconciliation.sql:13), [job.executor.js](../backend/src/jobs/job.executor.js:680)).
- Stage 5: PARTIAL. Supabase storage adapter exists ([supabase.storage.js](../backend/src/storage/supabase.storage.js:52)).
- Stage 6: PARTIAL. Mode-A providers integrated in code ([provider.adapter.js](../backend/src/providers/provider.adapter.js:3)).
- Stage 7: PARTIAL. Mode-B pipeline branch exists ([job.executor.js](../backend/src/jobs/job.executor.js:333)).
- Stage 8: PARTIAL. Mode-B layout-aware renderer added ([text.output.js](../backend/src/pdf/text.output.js:117)).
- Stage 9: PARTIAL. Deterministic output cache added ([cache.key.js](../backend/src/cache/cache.key.js:3), [job.executor.js](../backend/src/jobs/job.executor.js:273)).
- Stage 10: PARTIAL overall, CLOSED for metrics hardening. Shared rate-limit and retention hooks added ([rate-limit.store.js](../backend/src/security/rate-limit.store.js:38), [scripts/retention_cleanup.mjs](../scripts/retention_cleanup.mjs:1), [jobs.routes.js](../backend/src/routes/jobs.routes.js:156)).

## 4) Remaining external blockers
- Supabase operator steps not evidenced live: `npx supabase login`, `npx supabase link --project-ref movsrrbnurybokbdmkly`, `npx supabase db push` ([docs/FINAL_VERIFICATION.md](../docs/FINAL_VERIFICATION.md:5)).
- DeepL live credential proof pending ([docs/FINAL_VERIFICATION.md](../docs/FINAL_VERIFICATION.md:15)).
- Google live credential proof pending ([docs/FINAL_VERIFICATION.md](../docs/FINAL_VERIFICATION.md:26)).
- OpenAI/Groq live credential proof pending ([docs/FINAL_VERIFICATION.md](../docs/FINAL_VERIFICATION.md:36)).
- 2-worker distributed claim live proof pending ([docs/FINAL_VERIFICATION.md](../docs/FINAL_VERIFICATION.md:50)).
- Shared rate-limit live proof pending ([docs/FINAL_VERIFICATION.md](../docs/FINAL_VERIFICATION.md:63)).
- Real representative PDF acceptance corpus: No evidence found.

## 5) Recommended go/no-go statement
- Safe for internal alpha: YES (existing regression/test evidence is green).
- Safe for controlled beta: CONDITIONAL (after external blocker checklist execution).
- Safe for public launch: NO-GO for now (multiple critical risks remain PARTIAL due to missing live external proofs).
