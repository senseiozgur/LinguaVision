# Cost Strategy (Phase-0)

## Principles
- iOS-first akis: kullanici hizli önizleme almali, tam belge çevirisi opsiyonel olmali.
- Varsayilan düsük maliyet: önce economy tier, kalite gerekirse kontrollü escalation.
- Guardrail'siz fallback yasak: her fallback öncesi paket limitleri ve remaining budget kontrol edilir.
- Kanit referanslari:
- `sources/pdf-translator-for-human/README.md:21-26` (sayfa bazli tüketim mantigi)
- `sources/PDFMathTranslate/docs/ADVANCED.md:265-270` (cache ile API çagrisi azaltma)
- `sources/ProCeviriAI/app.py:343-427` (retry + fallback davranisi)

## Packaging Model

| Paket | Input Limit | Default Tier | max_cost_tier | max_escalations | Fallback | Strict/Readable |
|---|---|---|---|---|---|---|
| Free | max 20 sayfa, max 25 MB | economy | standard | 1 | economy -> standard (tek adim) | Readable only |
| Pro | max 200 sayfa, max 80 MB | standard | premium | 2 | standard -> economy (hata) veya standard -> premium (kalite düsüsü) | Strict + Readable |
| Premium | max 800 sayfa, max 250 MB | premium | premium | 3 | premium -> standard -> economy (kontrollü) | Strict + Readable |

## Cache Strategy
- Hash key: `doc_sha256 + page_no + source_lang + target_lang + tier + mode + glossary_version`.
- Cache birimi: sayfa basina çeviri sonucu + layout metadata.
- Cache hit durumunda provider çagrisi yapilmaz.
- Forced refresh sadece explicit kullanici istegi ile (`ignore_cache=true`) açilir.

## Chunking Strategy
- Varsayilan chunk: 8-12 text block/sayfa (baslangiç: 10).
- Strict mode: küçük chunk + layout anchor korunumu.
- Readable mode: daha büyük chunk + akicilik önceligi.
- Chunk büyütme yalnizca timeout/rate-limit yoksa yapilir.

## Strict vs Readable
- Strict: font kutusu tasmasini minimize eder, sayi/formül korumasi yüksek, daha pahali olabilir.
- Readable: dil akiciligi öncelikli, düsük maliyetli model/tier kullanilabilir.
- Free paketinde Strict kapalidir.

## Spend Guardrails
- Her job için `estimated_cost_units` ve `spent_units` tutulur.
- Job baslatmadan önce "en kötü durum" (default tier + max escalation) hesaplanir.
- Tahmini worst-case, paket bütçesini asiyorsa job baslatilmaz (`COST_GUARD_BLOCK`).
- Runtime sirasinda limit asilirsa yeni escalation engellenir ve bir alt tier ile devam edilir veya fail-safe durdurulur.

## Policy Handoff
- Bu dosyadaki paket/tier kurallari teknik olarak `research/router_policy.md` içinde deterministic kurallara dönüstürülmüstür.
