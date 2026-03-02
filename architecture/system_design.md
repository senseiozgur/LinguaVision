# iOS-First System Design (Canonical)

## Goal
PDF çevirisinde format bozulmasini minimize eden, maliyet kontrollü ve sade bir iOS-first sistem.

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
- Billing adapter çagrisi
- Router policy ile provider seçimi
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
- `ProviderAdapter`: tek tip `translate_chunk/translate_page` sözlesmesi
- `CostGuard`: package limit + runtime spend check

## iOS-first Decisions
- Önce mobil deneyim: job/polling modelinin response alanlari sabit tutulur.
- Uzun islemler arkaplanda; iOS sadece statü ve progress yönetir.
- Basarisizlikta normalize error kodlari döner; ham provider hatasi dönülmez.

## Simplicity Constraints
- Tek backend process ile baslanir (monolith).
- Event bus/queue gibi ek bilesenler Phase-0'da yok.
- Multi-provider karmasasi router policy üzerinden tek noktada yönetilir.

## Migration Baseline (from lingua-Deepl)
- Alinacak omurga:
- `backend/src/routes/jobs.routes.ts`
- `backend/src/jobs/job.runner.ts`
- `backend/src/providers/provider.interface.ts`
- `backend/src/storage/local.storage.ts`
- iOS polling modeli: `ios-client/LinguaFlowIOS/TranslateViewModel.swift`

## Why This Wins
- iOS-first hedefle dogrudan uyumlu asenkron job akisi.
- Fallback + maliyet denetimi canonical policy ile merkezi.
- Over-engineering olmadan ölçeklenebilir modülerlik.

## Evidence
- API/job model: `D:/dev/proje/Deepl/docs/API_CONTRACT.md`, `D:/dev/proje/Deepl/backend/src/routes/jobs.routes.ts`
- Runner ve billing/refund davranisi: `D:/dev/proje/Deepl/backend/src/jobs/job.runner.ts`
- Provider abstraction: `D:/dev/proje/Deepl/docs/PROVIDER_ARCHITECTURE.md`
- Layout-preserving yaklasim: `D:/dev/proje/LinguaVision/sources/PDFMathTranslate/README.md:53`, `.../pdf2zh/converter.py`
