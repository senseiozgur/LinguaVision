# Repo Comparison (Phase-0)

## Scope
- PDFMathTranslate/PDFMathTranslate: https://github.com/PDFMathTranslate/PDFMathTranslate
- davideuler/pdf-translator-for-human: https://github.com/davideuler/pdf-translator-for-human
- 4hmetziya/ProCeviriAI: https://github.com/4hmetziya/ProCeviriAI
- Reference (read-only): senseiozgur/lingua-Deepl https://github.com/senseiozgur/lingua-Deepl

## Comparison Table (Fikir / Mimari / Urunlestirme)

| Repo | Fikir | Mimari | Urunlestirme | iOS-first Uygunluk | Maliyet Kontrolu | Kanit |
|---|---|---|---|---|---|---|
| PDFMathTranslate | Bilimsel PDF cevirisinde layout korumayi ana deger olarak konumluyor. | `pdf2zh/converter.py` + `pdf2zh/doclayout.py` ile layout siniflandirma, coklu translator ve cache katmani var. | CLI + GUI + Docker + API referanslari mevcut. | Dogrudan iOS SDK yok; servislestirme yapildiginda iOS istemcisi baglanabilir. | Cache ve servis secimi var ama paket bazli maliyet limiti yok. | `https://github.com/PDFMathTranslate/PDFMathTranslate/blob/main/README.md`, `https://github.com/PDFMathTranslate/PDFMathTranslate/blob/main/docs/ADVANCED.md`, `https://github.com/PDFMathTranslate/PDFMathTranslate/blob/main/pdf2zh/translator.py`, `https://github.com/PDFMathTranslate/PDFMathTranslate/blob/main/pdf2zh/converter.py` |
| pdf-translator-for-human | Kullaniciyi sayfa bazli okuma + gerektiginde ceviri yaklasimina yonlendiriyor. | Streamlit tabanli tek uygulama; per-page ceviri + `.cached` klasor cache. | Kisisel kullanim odakli; API sozlesmesi/zorunlu is kuyrugu yok. | iOS-first icin dogrudan uygun degil; backend servis katmani gerekir. | Google/OpenAI secimi ve page-level cache var; butce/escalation guardrail yok. | `https://github.com/davideuler/pdf-translator-for-human/blob/main/README.md`, `https://github.com/davideuler/pdf-translator-for-human/blob/main/app.py` |
| ProCeviriAI | Turkce odakli PDF ceviri ve okunabilir font iyilestirmesi hedefliyor. | Flask benzeri tek dosya akis; Groq ana motor + Google fallback + chunk (10 satir). | Prototip seviyesinde; operational separation sinirli. | iOS-first icin uygun hale getirilebilir ama once moduler API ayrimi gerekir. | Retry + fallback var; ancak paket, tier veya toplam maliyet tavani kurali yok. | `https://github.com/4hmetziya/ProCeviriAI/blob/main/README_UPDATE.md`, `https://github.com/4hmetziya/ProCeviriAI/blob/main/app.py` |
| lingua-Deepl (ref) | Provider-agnostic prensibi ve job lifecycle stabilitesini acik hedef yapiyor. | Ayrik katman: routes/job runner/provider factory/billing adapter/storage. | API sozlesmesi + testler + iOS istemci akisi mevcut. | iOS-first icin en guclu referans; async job modeli iOS polling ile uyumlu. | Deterministic charge/refund akisi var; fakat tek provider ve routing tier sistemi henuz yok. | `D:/dev/proje/Deepl/docs/PROJECT_INTENT_AND_LESSONS.md:16-22`, `D:/dev/proje/Deepl/backend/src/jobs/job.runner.ts:31-82`, `D:/dev/proje/Deepl/backend/src/providers/provider.factory.ts:14-25`, `D:/dev/proje/Deepl/docs/API_CONTRACT.md:32-148`, `D:/dev/proje/Deepl/ios-client/LinguaFlowIOS/TranslateViewModel.swift:35-89` |

## Key Decisions for LinguaVision
- Layout koruma icin temel teknik yon: PDFMathTranslate benzeri layout-aware extraction + controlled redraw.
- Urun omurgasi icin temel yon: lingua-Deepl benzeri `jobs + provider adapter + billing adapter + storage` sade katmanlama.
- Maliyet ve fallback icin: ProCeviriAI'deki fallback fikri alinacak, ama `research/router_policy.md` ile deterministik guardrail zorunlu olacak.
- Sayfa bazli kademeli ceviri UX fikri korunacak, fakat iOS tarafinda backend job API ile uygulanacak.

## Reusable Pieces (Directly Adopt / Avoid)
- Adopt: `lingua-Deepl` job lifecycle ve API contract yapisi (`D:/dev/proje/Deepl/backend/src/routes/jobs.routes.ts`, `D:/dev/proje/Deepl/docs/API_CONTRACT.md`).
- Adopt: `PDFMathTranslate` layout + cache kabiliyeti (`https://github.com/PDFMathTranslate/PDFMathTranslate/blob/main/pdf2zh/converter.py`, `https://github.com/PDFMathTranslate/PDFMathTranslate/blob/main/pdf2zh/translator.py`).
- Adopt with constraints: `ProCeviriAI` retry/fallback fikri ama kuralsiz degil, policy tabanli (`https://github.com/4hmetziya/ProCeviriAI/blob/main/app.py`).
- Avoid: Tek dosya app icinde UI + routing + translate karmasasi (`https://github.com/4hmetziya/ProCeviriAI/blob/main/app.py`).
- Avoid: iOS'a dogrudan Streamlit baglama yaklasimi (`https://github.com/davideuler/pdf-translator-for-human/blob/main/app.py`).

## Final Selection (Phase-0)
1. Core architecture baseline: `lingua-Deepl`.
2. PDF fidelity strategy baseline: `PDFMathTranslate`.
3. Runtime fallback inspiration: `ProCeviriAI` (policy-constrained).
4. UX behavior inspiration: `pdf-translator-for-human` page-first consumption.

## Non-Goals (Phase-0)
- Kod degisikligi yok.
- Provider benchmark calistirmasi yok.
- Gercek provider cagrisi yok.
