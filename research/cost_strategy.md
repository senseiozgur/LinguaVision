# Cost Strategy (Phase-0)

## Principles
- iOS-first akis: kullanici hizli onizleme almali, tam belge cevirisi opsiyonel olmali.
- Varsayilan dusuk maliyet: once economy tier, kalite gerekirse kontrollu escalation.
- Guardrail'siz fallback yasak: her fallback oncesi paket limitleri ve remaining budget kontrol edilir.
- Kanit referanslari:
- `D:/dev/proje/LinguaVision/sources/pdf-translator-for-human/README.md:21-26` (sayfa bazli tuketim mantigi)
- `D:/dev/proje/LinguaVision/sources/PDFMathTranslate/docs/ADVANCED.md:265-270` (cache ile API cagrisi azaltma)
- `D:/dev/proje/LinguaVision/sources/ProCeviriAI/app.py:343-427` (retry + fallback davranisi)

## Packaging Model

| Paket | Input Limit | Default Tier | max_cost_tier | max_escalations | Fallback | Strict/Readable |
|---|---|---|---|---|---|---|
| Free | max 20 sayfa, max 25 MB | economy | standard | 1 | economy -> standard (tek adim) | Readable only |
| Pro | max 200 sayfa, max 80 MB | standard | premium | 2 | standard -> premium -> economy | Strict + Readable |
| Premium | max 800 sayfa, max 250 MB | premium | premium | 3 | premium -> standard -> economy | Strict + Readable |

## Cost Unit Model
- Base unit: `1 page = 1 unit` (Phase-0 planning varsayimi).
- Tier multipliers:
- economy: x1.0
- standard: x1.8
- premium: x3.0
- Worst-case estimate:
- `pages * default_multiplier + (pages * escalation_multiplier * max_escalations_fraction)`.
- Admission check bu estimate ile yapilir.

## Cache Strategy
- Hash key: `doc_sha256 + page_no + source_lang + target_lang + tier + mode + glossary_version`.
- Cache birimi: sayfa basina ceviri sonucu + layout metadata.
- Cache hit durumunda provider cagrisi yapilmaz.
- Forced refresh sadece explicit kullanici istegi ile (`ignore_cache=true`) acilir.

## Chunking Strategy
- Varsayilan chunk: 8-12 text block/sayfa (baslangic: 10).
- Strict mode: kucuk chunk + layout anchor korunumu.
- Readable mode: daha buyuk chunk + akicilik onceligi.
- Chunk buyutme yalnizca timeout/rate-limit yoksa yapilir.

## Strict vs Readable
- Strict: font kutusu tasmasini minimize eder, sayi/formul korumasi yuksek, daha pahali olabilir.
- Readable: dil akiciligi oncelikli, dusuk maliyetli model/tier kullanilabilir.
- Free paketinde Strict kapalidir.

## Spend Guardrails
- Her job icin `estimated_cost_units` ve `spent_units` tutulur.
- Job baslatmadan once "en kotu durum" (default tier + max escalation) hesaplanir.
- Tahmini worst-case, paket butcesini asiyorsa job baslatilmaz (`COST_GUARD_BLOCK`).
- Runtime sirasinda limit asilirse yeni escalation engellenir ve bir alt tier ile devam edilir veya fail-safe durdurulur.

## Policy Handoff
- Bu dosyadaki paket/tier kurallari teknik olarak `research/router_policy.md` icinde deterministik kurallara donusturulmustur.

## Freeze Decision Sync
- Cost guard iki asamali zorunlu: admission + runtime.
- Paket fallback zinciri degistirilmeyecek (sabit).
- strict/readable secici UI Phase-1 ilk teslimde yok (`REVIEW LATER`).
