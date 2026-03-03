# iOS-First System Design (Canonical)

## Goal
PDF cevirisinde format bozulmasini minimize eden, maliyet kontrollu ve sade bir iOS-first sistem.

## Target Architecture
1. iOS App (SwiftUI)
- Upload PDF
- Job baslat (`POST /jobs`)
- Run (`POST /jobs/{id}/run`)
- Poll (`GET /jobs/{id}`)
- Output indir (`GET /jobs/{id}/output`)

2. API Layer
- `jobs` route: input validation + response contract
- Minimal auth/session boundary
- Idempotent job trigger korumasi

3. Job Orchestrator
- State machine: `PENDING -> PROCESSING -> READY|FAILED`
- Billing adapter cagrisi
- Router policy ile provider secimi
- Storage write/read

4. Translation Core
- PDF parse + layout anchors
- Chunk planner (strict/readable)
- Provider adapter interface (economy/standard/premium)
- Translation cache

5. Storage
- Input PDF (immutable)
- Output PDF
- Cache artifacts (page/chunk)

## Minimal Service Boundaries
- `JobsService`: lifecycle + API response shape
- `RoutingService`: `research/router_policy.md` kurallarini uygular
- `ProviderAdapter`: tek tip `translate_chunk/translate_page` sozlesmesi
- `CostGuard`: package limit + runtime spend check

## iOS-first Decisions
- Once mobil deneyim: job/polling modelinin response alanlari sabit tutulur.
- Uzun islemler arkaplanda; iOS sadece statu ve progress yonetir.
- Basarisizlikta normalize error kodlari doner; ham provider hatasi donulmez.

## Request/Response Contract (Minimal)
- `POST /jobs` -> `{ job_id, status }`
- `POST /jobs/{id}/run` -> `{ accepted, job_id, status }`
- `GET /jobs/{id}` -> `{ status, progress_pct, error_code, billing{...} }`
- `GET /jobs/{id}/output` -> translated pdf bytes

## End-to-End Sequence
1. iOS dosyayi yukler ve job olusturur.
2. iOS `run` cagirir, backend `PENDING -> PROCESSING` gecer.
3. Orchestrator billing charge + provider route + translate yapar.
4. Basarida output yazilir, `READY` doner.
5. Hata durumunda normalize code + gerekiyorsa refund + `FAILED` doner.

## Simplicity Constraints
- Tek backend process ile baslanir (monolith).
- Event bus/queue gibi ek bilesenler Phase-0'da yok.
- Multi-provider karmasasi router policy uzerinden tek noktada yonetilir.

## Migration Baseline (from lingua-Deepl)
- Alinacak omurga:
- `D:/dev/proje/Deepl/backend/src/routes/jobs.routes.ts`
- `D:/dev/proje/Deepl/backend/src/jobs/job.runner.ts`
- `D:/dev/proje/Deepl/backend/src/providers/provider.interface.ts`
- `D:/dev/proje/Deepl/backend/src/storage/local.storage.ts`
- iOS polling modeli: `D:/dev/proje/Deepl/ios-client/LinguaFlowIOS/TranslateViewModel.swift`

## Phase-1 Backlog (Implementation-ready)
1. `jobs` API scaffold (contract-first).
2. `RoutingService` with deterministic rules from canonical policy.
3. `ProviderAdapter` tier mapping (economy/standard/premium).
4. Page/chunk cache with hash key.
5. iOS polling + output download integration test.

## Why This Wins
- iOS-first hedefle dogrudan uyumlu asenkron job akisi.
- Fallback + maliyet denetimi canonical policy ile merkezi.
- Over-engineering olmadan olceklenebilir modulerlik.

## Evidence
- API/job model: `D:/dev/proje/Deepl/docs/API_CONTRACT.md`, `D:/dev/proje/Deepl/backend/src/routes/jobs.routes.ts`
- Runner ve billing/refund davranisi: `D:/dev/proje/Deepl/backend/src/jobs/job.runner.ts`
- Provider abstraction: `D:/dev/proje/Deepl/docs/PROVIDER_ARCHITECTURE.md`
- iOS polling akis referansi: `D:/dev/proje/Deepl/ios-client/LinguaFlowIOS/TranslateViewModel.swift:35-89`
- Layout-preserving yaklasim: `D:/dev/proje/LinguaVision/sources/PDFMathTranslate/README.md:53`, `D:/dev/proje/LinguaVision/sources/PDFMathTranslate/pdf2zh/converter.py`

## Freeze Decision Sync
- MVP (Phase-1 ilk teslim) scope: `create/run/poll/download`.
- strict/readable secici UI: `REVIEW LATER`.
- Cost guard kontrolu: hem admission hem runtime zorunlu.
- Fallback zinciri paket bazli sabit kalir.
