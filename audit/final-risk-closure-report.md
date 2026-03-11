# Final Risk Closure Report

## 1) Executive summary
- Maturity: internal hardening baseline reached and Mode-B extraction/render path materially advanced on `feature/modeb-groq-first-google-deepl`.
- Production-ready parts (internal scope): iOS contract/core regressions and worker/storage/claim hardening flows are implemented and repeatedly exercised in local/staging-style verification.
- Current truth for Mode-B: extraction fallback issue is resolved, body-focused extraction works, and external BabelDOC engine path is integrated as the active direction for Mode-B output.
- External runtime hardening was expanded with explicit controls for TLS and repetition fallback policy (`LV_BABELDOC_CA_BUNDLE`, `LV_BABELDOC_INSECURE_TLS`, `LV_BABELDOC_ALLOW_SOURCE_FALLBACK_ON_REPETITION`).
- Audit hardening updates (P0/P1 line): MODE-A silent passthrough success is disabled by default, charge-failure paths are terminalized (`FAILED`), simulation query flags are default-off behind `LV_ENABLE_SIMULATION_FLAGS`, and daily-cap denial now maps to deterministic billing error semantics.
- Remaining boundary: Mode-B output quality is improved but still not equivalent to full high-fidelity natural-document reconstruction on broad complex PDF sets.
- External blockers still matter for full closure: live provider credential matrix, broader representative corpus, and final operator-side environment proofs ([docs/FINAL_VERIFICATION.md](../docs/FINAL_VERIFICATION.md)).

## 2) Top 10 risk closure table
| Risk | Status | Evidence | Why not fully closed (if partial/open) | What exact proof is still missing |
|---|---|---|---|---|
| In-memory job/state loss on restart | PARTIAL | Jobs schema and repo exist: [20260306130000_jobs.sql](../supabase/migrations/20260306130000_jobs.sql:3), [job.repo.js](../backend/src/jobs/job.repo.js:59) | Fallback to in-memory still possible when Supabase env unavailable: [server.js](../backend/src/server.js:44) | Remote DB-mode restart proof after `supabase db push` |
| No distributed claim / double-processing | PARTIAL | Claim RPC + repo calls: [20260306143000_atomic_claim_rpc.sql](../supabase/migrations/20260306143000_atomic_claim_rpc.sql:3), [job.repo.js](../backend/src/jobs/job.repo.js:208) | Live multi-worker run not evidenced | 2-worker claim proof ([docs/FINAL_VERIFICATION.md](../docs/FINAL_VERIFICATION.md:50)) |
| Provider integration missing | PARTIAL | Adapters wired: [provider.adapter.js](../backend/src/providers/provider.adapter.js:3), [provider.adapter.js](../backend/src/providers/provider.adapter.js:5), [provider.adapter.js](../backend/src/providers/provider.adapter.js:6) | Live credentials not proven | DeepL/Google/OpenAI/Groq live proofs |
| Mode-B layout fidelity | PARTIAL (Improved) | Sidecar extraction boundary is stable and BabelDOC external engine integration is active for Mode-B runtime path (`backend/src/pdf/engine.babeldoc.js`, `scripts/babeldoc_runner.py`) with explicit env controls; validated with real-file flow (`backend/ornek.pdf`) | Full natural-document rebuild quality across diverse PDFs is still not evidenced; external path behavior under constrained VPN/TLS conditions still needs stronger live evidence | Multi-document quality benchmark + acceptance corpus proof + stable live external run matrix |
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
- Stage 8: PARTIAL (materially improved). Mode-B layout-aware renderer and sidecar-driven extraction quality were iteratively strengthened on feature branch.
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

## 5) Mode-B Progress Chain (Feature Branch)
- `2e05a46`: PyMuPDF sidecar extraction boundary introduced.
- `dbc0a78`: extraction ordering and noise suppression improvements.
- `7c0ec47`: UTF-8 sidecar IO cleanup.
- `06cfeab`: body-focused extraction and layout mapping improvement.
- `9dd641c`: paragraph reconstruction heuristics refinement.
- `7155fff`: role-based block rendering readability improvement.
- `83b731a`: heading/body transition and paragraph typography refinement.
- `f039bab`: long body rhythm softening.
- `15ad352`: overflow/page-fit compaction improvement.
- `69375a9`: bbox-aware fit flow stabilized with measurable readability gain.

## 6) Recommended go/no-go statement
- Safe for internal alpha: YES (existing regression/test evidence is green).
- Safe for controlled beta: CONDITIONAL (after external blocker checklist execution).
- Safe for public launch: NO-GO for now (multiple critical risks remain PARTIAL due to missing live external proofs).
