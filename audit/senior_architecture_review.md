# Senior Yazılım Mimarı İncelemesi (LinguaVision)

Bu doküman, projenin mevcut backend ve dokümantasyon yapısının kıdemli mimar perspektifinden değerlendirmesidir.

## 1) Kod Kalitesi ve Standartlar

### Güçlü yönler
- İsimlendirme genel olarak domain-odaklı ve açık (`validateAdmission`, `planRoute`, `translation_cache_hit`, `quality_gate_passed`).
- Router seviyesinde erken validasyon (guard clauses) okunabilirliği ve kontrol akışını iyileştiriyor.
- `JobStore`, `JobQueue`, `ProviderAdapter`, `BillingAdapter` ayrımı ile sorumluluklar net ayrılmış.

### İyileştirme alanları
- `createJobsRouter` içindeki `processJob` fonksiyonu çok uzun; billing, retry/fallback, quality gate, output persist ve failure/refund akışlarını ayrı servis fonksiyonlarına bölmek okunabilirliği artırır.
- Bazı fonksiyonlarda `catch {}` kullanımı teşhis kabiliyetini düşürüyor; en azından yapılandırılmış bir log/metric event bırakılmalı.
- `JobStore` in-memory ve mutable nesnelerle çalışıyor; testlerde yeterli ama prod-grade için repository katmanı ve persistence abstraction önerilir.

## 2) Mimari Yapı

### Güçlü yönler
- Adapter pattern kullanımı belirgin (`provider.adapter`, `billing.supabase`, `billing.stub`) ve test edilebilirliği artırıyor.
- Router policy ve cost guard mantığı domain-level policy olarak ayrıştırılmış.
- Fallback chain + retry stratejisi belirli ve deterministik; iOS kontratının stabil kalmasına yardımcı.

### Riskler
- Queue tek worker ve in-memory. Süreç restart'ında queue/job state kaybı olur; çok instance çalışmada ordering/idempotency karmaşası çıkar.
- API, orchestrator ve domain policy aynı route dosyasında birleşmiş; büyüme ile birlikte bakım maliyeti hızla artar.
- Layout pipeline şimdilik passthrough v1; mimari niyet iyi, ancak gerçek PDF reflow karmaşıklığı için ayrı bir bounded context gerekebilir.

## 3) Güvenlik

### Güçlü yönler
- Upload dosya adı sanitize ediliyor.
- Dil kodu, paket/mode ve query param validasyonları mevcut.
- Supabase tarafında RLS etkin ve service_role policy tanımlı.

### Kritik/öncelikli riskler
1. Global auth/rate limiting yok: route'lar doğrudan erişilebilir durumda.
2. Upload boyutu multer seviyesinde limitlenmemiş; admission kontrolü sonradan çalışsa da memoryStorage ile büyük payload riskli.
3. `/jobs/:id/output` ve `/jobs/:id` endpointlerinde kullanıcı sahipliği kontrolü yok (tenant isolation riski).
4. `/jobs/metrics` endpointi operasyonel sinyal sızdırabilir; auth veya internal ağ kısıtı gerekli.

## 4) Performans ve Ölçeklenebilirlik

### Gözlemler
- `runLayoutPipeline` block/chunk işlemleri lineer (`O(n)`), mevcut yaklaşım basit ve öngörülebilir.
- Fallback chain sabit küçük bir dizi üzerinde (`O(k)`, pratikte sabit).
- Translation cache Map tabanlı LRU + optional disk persist ile latency iyileştirmesi sağlıyor.

### Potansiyel bottleneckler
- In-memory queue ve store yatay ölçeklenmez.
- `saveToDisk` her cache set işleminde sync write yapıyor; yüksek throughput'ta I/O baskısı yaratabilir.
- Tüm input/output dosyaları local diskte; container scaling ve HA senaryolarında shared object storage gerekecek.

## 5) Hata Yönetimi ve Testler

### Güçlü yönler
- Error code'lar iOS-odaklı normalize edilmiş (`mapErrorToUxHint`, `toSafeBillingErrorCode`).
- Billing idempotency ve concurrency için testler mevcut.
- E2E/contract test yaklaşımı güçlü; jobs flow, iOS contract ve smoke testleri sistem davranışını doğruluyor.

### İyileştirme alanları
- `catch {}` bloklarında correlation id ile log yok; incident triage zorlaşır.
- Unit test oranı route-seviye entegrasyon testlerine göre daha düşük; saf fonksiyonlar için daha ayrıntılı sınır/test matrisi önerilir.
- Negatif güvenlik testleri (auth bypass, payload abuse, rate limit) eksik.

## 6) iOS Projeleri Bağlamında Ek İnceleme

### Muhtemel iOS entegrasyon riskleri
- Polling yükü: adaptif polling önerisi var ancak backend tarafında rate-limit veya backoff zorunluluğu yok.
- Hata kodlarının kullanıcı aksiyonuna dönüşmesi iyi düşünülmüş; fakat localization ve UX metin matrisi dokümante edilmemiş.
- Long-running job'larda `PROCESSING` yüzdesi statik/ sınırlı; iOS progress UX için daha iyi ara milestone gerekebilir.

### Ödeme sistemi/iOS bağlantısı
- `request_id` odaklı idempotency iyi.
- Client kaynaklı tekrar denemelerde çift charge riski azaltılmış.
- Ancak ödeme ve job sahipliğinin aynı kullanıcıyla kriptografik/kimlik doğrulamalı bağlanması şu anda route katmanında görünmüyor.

## 7) Dokümantasyon

### Güçlü yönler
- `architecture/system_design.md` ve `research/*` altında süreç olgunluğu yüksek.
- iOS kontrat snapshot ve migration notları net.
- Billing contract ve SQL migration izlenebilir.

### Eksikler
- Repo kökünde operasyonel hızlı başlangıç, env değişkenleri ve güvenlik varsayımları içeren bir `README.md` yok.
- Kod içi yorumlar kritik noktalarda var ama error/telemetry stratejisi için merkezi bir geliştirme kılavuzu eksik.
## Sonuç

### İyi yaptığınız noktalar
- iOS kontratını stabilize eden endpoint tasarımı ve compat test yaklaşımı.
- Billing tarafında idempotency düşünülmüş olması.
- Fallback, quality gate, cache ve metrics ile ürün-operasyon dengesini kurmaya çalışmanız.
### Acil düzeltilmesi gerekenler
1. AuthN/AuthZ ve tenant isolation eklenmesi (özellikle `GET /jobs/:id`, `/output`, `/metrics`).

2. Upload ve API rate limitlerinin aktif edilmesi (memoryStorage riskini azaltmak için upload sınırı + streaming strateji).
3. `processJob` orchestration akışını küçük servis/modüllere bölerek bakım ve testlenebilirliği artırma.

### Projeyi bir üst seviyeye taşıyacak 3 somut öneri
1. **Production orchestration katmanı**: Redis tabanlı queue (BullMQ vb.), kalıcı job state (Postgres) ve worker process ayrımı.
2. **Security hardening paketi**: JWT tabanlı kullanıcı kimliği, kaynak sahipliği kontrolü, rate limit + abuse protection, `/metrics` internal-only.
3. **Observability & reliability**: Structured logging (request_id/job_id), distributed tracing, SLO dashboard ve alert policy (özellikle provider timeout/refund başarısızlıkları için).
