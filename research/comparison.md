# Repo Comparison (Phase-0)

## Scope
- PDFMathTranslate/PDFMathTranslate: https://github.com/PDFMathTranslate/PDFMathTranslate
- davideuler/pdf-translator-for-human: https://github.com/davideuler/pdf-translator-for-human
- 4hmetziya/ProCeviriAI: https://github.com/4hmetziya/ProCeviriAI
- Reference (read-only): senseiozgur/lingua-Deepl https://github.com/senseiozgur/lingua-Deepl

## Comparison Table (Fikir / Mimari / Ürünlestirme)

| Repo | Fikir | Mimari | Ürünlestirme | iOS-first Uygunluk | Maliyet Kontrolü | Kanit |
|---|---|---|---|---|---|---|
| PDFMathTranslate | Bilimsel PDF çevirisinde layout korumayi ana deger olarak konumluyor. | `pdf2zh/converter.py` + `pdf2zh/doclayout.py` ile layout siniflandirma, çoklu translator ve cache katmani var. | CLI + GUI + Docker + API referanslari mevcut. | Dogrudan iOS SDK yok; servislestirme yapildiginda iOS istemcisi baglanabilir. | Cache ve servis seçimi var ama paket bazli maliyet limiti yok. | `README.md:53`, `docs/ADVANCED.md:59-69`, `docs/ADVANCED.md:265-270`, `pdf2zh/translator.py:90-102`, `pdf2zh/converter.py:162-166` |
| pdf-translator-for-human | Kullaniciyi sayfa bazli okuma + gerektiginde çeviri yaklasimina yönlendiriyor. | Streamlit tabanli tek uygulama; per-page çeviri + `.cached` klasör cache. | Kisisel kullanim odakli; API sözlesmesi/zorunlu is kuyrugu yok. | iOS-first için dogrudan uygun degil; backend servis katmani gerekir. | Google/OpenAI seçimi ve page-level cache var; bütçe/escalation guardrail yok. | `README.md:21-26`, `app.py:119-147`, `app.py:149-191`, `app.py:364-372`, `app.py:421-432` |
| ProCeviriAI | Türkçe odakli PDF çeviri ve okunabilir font iyilestirmesi hedefliyor. | Flask benzeri tek dosya akis; Groq ana motor + Google fallback + chunk (10 satir). | Prototip seviyesinde; operational separation sinirli. | iOS-first için uygun hale getirilebilir ama önce modüler API ayrimi gerekir. | Retry + fallback var; ancak paket, tier veya toplam maliyet tavani kurali yok. | `README_UPDATE.md:8`, `app.py:343-427`, `app.py:879-885`, `app.py:537-547`, `app.py:1046-1080` |
| lingua-Deepl (ref) | Provider-agnostic prensibi ve job lifecycle stabilitesini açik hedef yapiyor. | Ayrik katman: routes/job runner/provider factory/billing adapter/storage. | API sözlesmesi + testler + iOS istemci akisi mevcut. | iOS-first için en güçlü referans; async job modeli iOS polling ile uyumlu. | Deterministic charge/refund akisi var; fakat tek provider ve routing tier sistemi henüz yok. | `docs/PROJECT_INTENT_AND_LESSONS.md:16-22`, `backend/src/jobs/job.runner.ts:31-82`, `backend/src/providers/provider.factory.ts:14-25`, `docs/API_CONTRACT.md:32-148`, `ios-client/LinguaFlowIOS/TranslateViewModel.swift:35-89` |

## Key Decisions for LinguaVision
- Layout koruma için temel teknik yön: PDFMathTranslate benzeri layout-aware extraction + controlled redraw (https://github.com/PDFMathTranslate/PDFMathTranslate, `pdf2zh/converter.py`, `pdf2zh/doclayout.py`).
- Ürün omurgasi için temel yön: lingua-Deepl benzeri `jobs + provider adapter + billing adapter + storage` sade katmanlama (`backend/src/jobs/job.runner.ts`, `backend/src/routes/jobs.routes.ts`).
- Maliyet ve fallback için: ProCeviriAI'deki aktif fallback fikri alinir, ancak kurallar `router_policy.md` içinde deterministic guardrail'e baglanir (`app.py:343-427`).
- Sayfa bazli kademeli çeviri UX fikri korunur (pdf-translator-for-human `README.md:21-26`), fakat iOS tarafinda backend job API ile uygulanir.

## Non-Goals (Phase-0)
- Kod degisikligi yok.
- Provider benchmark çalistirmasi yok.
- Gerçek provider çagrisi yok.
