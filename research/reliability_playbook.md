# Reliability Playbook (LV-15)

## Scope
Operational fallback and rollback toggles for backend runtime without code changes.

## Emergency Toggles
- `DISABLE_LAYOUT_PIPELINE=1`
  - Effect: bypass layout parse/anchor/reflow, passthrough output mode.
  - Use when layout pipeline causes instability or high latency.
- `DISABLE_TRANSLATION_CACHE=1`
  - Effect: disables cache get/set path.
  - Use when cache corruption/memory pressure risk appears.
- `DISABLE_STRICT_QUALITY_GATE=1`
  - Effect: strict quality gate block is skipped.
  - Use when strict gate causes false-negative failures in production.
- `TRANSLATION_CACHE_PERSIST=0`
  - Effect: disables disk persistence of cache.
  - Use when storage IO errors are observed.

## Verification
1. Start backend with toggles.
2. Call `GET /jobs/metrics` and verify:
- `feature_disable_layout_pipeline`
- `feature_disable_translation_cache`
- `feature_disable_strict_quality_gate`
3. Run smoke contract tests:
- `npm run test:scaffold`
- `npm run test:flow`

## Rollback Order
1. Disable strict gate only (`DISABLE_STRICT_QUALITY_GATE=1`) to reduce false blocks.
2. Disable layout pipeline (`DISABLE_LAYOUT_PIPELINE=1`) if failures continue.
3. Disable translation cache (`DISABLE_TRANSLATION_CACHE=1`) if memory/persist issues remain.
4. Disable cache persist (`TRANSLATION_CACHE_PERSIST=0`) for IO failures.

## Evidence
- Feature flag wiring: `backend/src/server.js`, `backend/src/routes/jobs.routes.js`, `backend/src/providers/provider.adapter.js`
- Metrics exposure: `backend/src/routes/jobs.routes.js`
