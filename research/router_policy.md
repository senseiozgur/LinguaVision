# Router Policy (Canonical)

## Inputs
- `package`: free | pro | premium
- `mode`: strict | readable
- `doc_meta`: pages, size_mb, lang_pair
- `runtime`: timeout_count, rate_limit_count, provider_error_code
- `cost`: estimated_units, spent_units, remaining_units

## Provider Tiers
- `economy`: dusuk maliyet, orta kalite
- `standard`: dengeli kalite/maliyet
- `premium`: en yuksek kalite, yuksek maliyet

## Package Rules
- free: default=economy, max_cost_tier=standard, max_escalations=1, strict=deny
- pro: default=standard, max_cost_tier=premium, max_escalations=2, strict=allow
- premium: default=premium, max_cost_tier=premium, max_escalations=3, strict=allow

## Ordered Fallback Chains
- free: economy -> standard
- pro: standard -> premium -> economy
- premium: premium -> standard -> economy

## Routing Algorithm (Deterministic)
1. Admission check:
- `pages/size_mb` paket limitlerini asiyorsa `INPUT_LIMIT_EXCEEDED`.
- `worst_case_units > remaining_units` ise `COST_GUARD_BLOCK`.
2. Initial provider tier:
- mode=strict ise `default tier` korunur, auto-downgrade kapali.
- mode=readable ise maliyet baskisinda downgrade izinli.
3. Runtime failure handling:
- `PROVIDER_RATE_LIMIT`, `PROVIDER_TIMEOUT`, `PROVIDER_UPSTREAM_5XX` -> ayni tier icinde 1 retry.
- Retry fail ise escalation/downgrade karari paket kuralina gore verilir.
4. Escalation constraints:
- `escalation_count >= max_escalations` ise yeni escalation yasak.
- `next_tier > max_cost_tier` ise escalation yasak.
5. Budget protection:
- `spent_units + next_step_estimate > remaining_units` ise escalation yasak.
- Uygun alt tier varsa downgrade; yoksa `COST_LIMIT_STOP`.
6. Provider outage fallback:
- Saglayici hard-down ise izinli siraya gore bir sonraki tier/provider denenir.
- Failover sonrasi toplam maliyet her adimda yeniden dogrulanir.

## Decision Scenarios

| Scenario | Package/Mode | Trigger | Result |
|---|---|---|---|
| S1 | Free / readable | economy timeout + retry fail | standard'a tek escalation, sonra stop |
| S2 | Free / readable | standard fail | `ROUTER_MAX_ESCALATION_REACHED` veya `ROUTER_NO_FALLBACK_PATH` |
| S3 | Pro / strict | standard quality fail + budget var | premium escalation |
| S4 | Pro / strict | premium fail + budget yok | standard veya economy downgrade, gerekirse `COST_LIMIT_STOP` |
| S5 | Premium / readable | premium rate-limit + retry fail | standard fallback, sonra economy |

## Error Code Contract
- `INPUT_LIMIT_EXCEEDED`
- `COST_GUARD_BLOCK`
- `COST_LIMIT_STOP`
- `ROUTER_MAX_ESCALATION_REACHED`
- `ROUTER_NO_FALLBACK_PATH`
- `PROVIDER_RATE_LIMIT`
- `PROVIDER_TIMEOUT`
- `PROVIDER_UPSTREAM_5XX`

## iOS Response Mapping
- `INPUT_LIMIT_EXCEEDED` -> kullaniciya plan limiti uyarisi + yukseltilmis paket CTA
- `COST_GUARD_BLOCK` -> tahmini maliyet asimi bilgisi
- `COST_LIMIT_STOP` -> islem durdu, kismi sonuc varsa indirilebilir
- `PROVIDER_*` -> otomatik yeniden deneme/fallback bilgisi

## Why This Policy
- Basitlik: tek giris denetimi + deterministik fallback zinciri.
- Maliyet kontrolu: her adimda budget check zorunlu.
- iOS-first: kullaniciya anlasilir durum kodlari doner; polling ekrani state yonetebilir.

## Evidence
- Provider abstraction prensibi: `D:/dev/proje/Deepl/docs/PROVIDER_ARCHITECTURE.md`
- Job/billing determinism: `D:/dev/proje/Deepl/backend/src/jobs/job.runner.ts`
- API polling shape: `D:/dev/proje/Deepl/docs/API_CONTRACT.md`, `D:/dev/proje/Deepl/ios-client/LinguaFlowIOS/TranslateViewModel.swift:60-89`
- Fallback pratigi (prototip): `D:/dev/proje/LinguaVision/sources/ProCeviriAI/app.py:343-427`
- Cache + multi-service yaklasimi: `D:/dev/proje/LinguaVision/sources/PDFMathTranslate/docs/ADVANCED.md:59-69`, `D:/dev/proje/LinguaVision/sources/PDFMathTranslate/docs/ADVANCED.md:265-270`

## Phase-1 Freeze Decisions (Olgun+Cevher)
- D1: Paket bazli sabit fallback zinciri korunacak (free: economy->standard, pro: standard->premium->economy, premium: premium->standard->economy).
- D2: MVP teslim kapsaminda iOS tarafi `async job + poll + output` ile sinirli.
- D3: Cost guard iki seviyeli zorunlu: admission worst-case block + runtime step guard.
- D4: `strict/readable` UI secicisi `REVIEW LATER`.

## Contract Freeze (Phase-1 Prep)

### Jobs API (Frozen)
| Endpoint | Success | Failure Codes |
|---|---|---|
| `POST /jobs` | `201 { job_id, status }` | `400 invalid_input` |
| `POST /jobs/{id}/run` | `202 { accepted, job_id, status }` | `404 job_not_found`, `409 job_already_running` |
| `GET /jobs/{id}` | `200 { job_id, status, progress_pct, error_code, billing{...} }` | `404 job_not_found` |
| `GET /jobs/{id}/output` | `200 application/pdf` | `404 job_not_found`, `409 job_not_ready` |

### Router/Budget Error Codes (Frozen)
- `INPUT_LIMIT_EXCEEDED`
- `COST_GUARD_BLOCK`
- `COST_LIMIT_STOP`
- `ROUTER_MAX_ESCALATION_REACHED`
- `ROUTER_NO_FALLBACK_PATH`
- `PROVIDER_RATE_LIMIT`
- `PROVIDER_TIMEOUT`
- `PROVIDER_UPSTREAM_5XX`

### Source Evidence
- `D:/dev/proje/Deepl/docs/API_CONTRACT.md`
- `D:/dev/proje/Deepl/backend/src/routes/jobs.routes.ts`
- `D:/dev/proje/Deepl/ios-client/LinguaFlowIOS/TranslateViewModel.swift`
