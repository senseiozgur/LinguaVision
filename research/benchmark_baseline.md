# Strict/Readable Benchmark Baseline (LV-18)

## Method
- Script: `scripts/benchmark_mode_baseline.mjs`
- Input size: ~3MB synthetic PDF-like buffer
- Iterations per mode: 20
- Cache: disabled (`disableTranslationCache=true`) to isolate mode effect
- Tier: `standard`

## Latest Result (2026-03-04)
- readable units: `30`
- strict units: `45`
- delta units: `+15`
- ratio: `1.5x`
- readable latency: `avg 3.67ms`, `p95 4.35ms`
- strict latency: `avg 3.74ms`, `p95 5.64ms`

## Interpretation
- Cost side behaves as intended: strict mode has deterministic +50% unit weight.
- Latency difference is small in current passthrough pipeline implementation; cost delta is the primary mode separator.

## Evidence
- `scripts/benchmark_mode_baseline.mjs`
- `backend/src/routing/cost.guard.js`
- `backend/src/providers/provider.adapter.js`
