# Coordination Log

## Protocol Summary
- Workspace: `D:/dev/proje/LinguaVision`
- Reference repo (read-only): `D:/dev/proje/Deepl` (`senseiozgur/lingua-Deepl`)
- Phase-0 scope: analysis only, no product code changes.
- Evidence rule: every technical claim must include repository file path or URL.
- Canonical decision files: `architecture/system_design.md`, `research/router_policy.md`.
- Lock rule: writer must declare LOCK/UNLOCK here.

## Bootstrap
- LOCK: chat/chat.md (bootstrap)
- UNLOCK: chat/chat.md (bootstrap-initialized)

## Team ACK
- [Olgun] ACK
- [Cevher] ACK
## Locks
- [Olgun] LOCK: research/comparison.md
- [Olgun] LOCK: research/router_policy.md
- [Olgun] LOCK: research/cost_strategy.md
- [Olgun] LOCK: architecture/system_design.md
- [Olgun] LOCK: tasks/tasks.md

## Coordination Updates
- [Cevher] STATUS REQUEST: research/comparison.md
- [Cevher] STATUS REQUEST: research/router_policy.md
- [Cevher] STATUS REQUEST: research/cost_strategy.md
- [Cevher] STATUS REQUEST: architecture/system_design.md
- [Cevher] STATUS REQUEST: tasks/tasks.md
- [Cevher] NOTE: `8b1866b` commit'i goruldu; lock kapanis (UNLOCK) kaydi bekleniyor.
- [Olgun] UNLOCK: research/comparison.md (8b1866b)
- [Olgun] UNLOCK: research/router_policy.md (8b1866b)
- [Olgun] UNLOCK: research/cost_strategy.md (8b1866b)
- [Olgun] UNLOCK: architecture/system_design.md (8b1866b)
- [Olgun] UNLOCK: tasks/tasks.md (8b1866b)

## Locks
- [Olgun] LOCK: research/comparison.md
- [Olgun] LOCK: research/router_policy.md
- [Olgun] LOCK: research/cost_strategy.md
- [Olgun] LOCK: architecture/system_design.md
- [Olgun] LOCK: tasks/tasks.md

## Async Protocol (No Wait)
- [Olgun] NOTE: Onay beklemeden ilerleme aktif. Her blok sonunda lock kapanisi + commit hash yazilacak.
- [Olgun] NOTE: Cevher `STATUS REQUEST` yazarsa ayni dosyada 1 blok icinde cevaplanacak.

## Coordination Round-2
- [Cevher] LOCK: chat/chat.md
- [Cevher] DISCUSSION TOPICS FOR OLGUN:
- [Cevher] 1) Router'da varsayilan yol: `economy -> standard -> premium` yerine paket bazli sabit zincir korunsun mu? (ref: `research/router_policy.md`)
- [Cevher] 2) iOS-first MVP'de ilk teslim: sadece async job + poll + output mi, yoksa ilk surumde strict/readable secici de zorunlu mu? (ref: `architecture/system_design.md`)
- [Cevher] 3) Cost guard dogrulama noktasi: admission'da worst-case block + runtime step guard ikisini birden zorunlu tutalim mi? (ref: `research/cost_strategy.md`, `research/router_policy.md`)
- [Cevher] PROPOSED EXECUTION ORDER (Phase-1 prep):
- [Cevher] A) Canonical freeze: `architecture/system_design.md` + `research/router_policy.md` son karar satirlari netlestir.
- [Cevher] B) Contract freeze: job/error kodlari tek tabloya sabitlenir (`research/router_policy.md` kaynakli).
- [Cevher] C) Implementation scaffold: lingua-Deepl omurgasindan minimal route/runner/provider arayuzu alinacak.
- [Cevher] D) Cost controls first: package limit + escalation guard kodu provider entegrasyonundan once.
- [Cevher] E) Provider adapters: economy/standard/premium zinciri, failover test senaryolari ile.
- [Cevher] F) iOS integration pass: create/run/poll/download ucundan uca.
- [Cevher] DECISION RULE: esit durumda daha basit yol secilecek; belirsiz madde `REVIEW LATER`.
- [Cevher] ACTION REQUEST: Olgun bu mesaja `AGREE` veya `COUNTER` ile satir bazli cevap versin.
- [Cevher] UNLOCK: chat/chat.md (coord-round2)
- [Olgun] LOCK: chat/chat.md
- [Olgun] AGREE-1: Paket bazli sabit fallback zinciri korunsun. Dinamik zincir degisimi sade degil ve maliyet kontrolunu zorlastirir. (canonical: `research/router_policy.md`)
- [Olgun] AGREE-2: iOS-first MVP ilk teslim sadece async job + poll + output olsun. strict/readable secici varsayilan `readable`; UI secici `REVIEW LATER`.
- [Olgun] AGREE-3: Admission worst-case block + runtime step guard ikisi de zorunlu olsun. Tek guard yeterli degil. (canonical: `research/cost_strategy.md`, `research/router_policy.md`)
- [Olgun] AGREE-ORDER: A->B->C->D->E->F sirasi kabul.
- [Olgun] NOTE: Belirsiz tek madde strict/readable UI secici; `REVIEW LATER` etiketiyle tutuldu.
- [Olgun] UNLOCK: research/comparison.md (757f295)
- [Olgun] UNLOCK: research/router_policy.md (757f295)
- [Olgun] UNLOCK: research/cost_strategy.md (757f295)
- [Olgun] UNLOCK: architecture/system_design.md (757f295)
- [Olgun] UNLOCK: tasks/tasks.md (757f295)
- [Olgun] UNLOCK: chat/chat.md (757f295)

## Async Cadence Protocol (ETA <= 4m)
- [Cevher] LOCK: chat/chat.md
- [Cevher] RULE-1: Her aktif blok icin `ETA: 3-4m` yazilir.
- [Cevher] RULE-2: ETA sonunda is bitmediyse diger kisi `WAIT: +2m` uygular, sonra tekrar kontrol eder.
- [Cevher] RULE-3: Ikinci kontrolde de update yoksa `STATUS REQUEST: <file>` yazilir; dosyaya mudahale edilmez.
- [Cevher] RULE-4: Blok bitis formati sabit: `UNLOCK: <file> (<commit-hash>)`.
- [Cevher] RULE-5: Her kararda once canonical guncellenir (`architecture/system_design.md`, `research/router_policy.md`), sonra diger dosyalar.
- [Cevher] RULE-6: Esit cozumde daha basit yol secilir; netlesmeyen karar `REVIEW LATER`.
- [Cevher] EXECUTION ORDER CONFIRMED: A -> B -> C -> D -> E -> F.
- [Cevher] NEXT TURN PLAN:
- [Cevher] A) Canonical freeze check (ETA: 4m)
- [Cevher] B) Contract freeze extraction (ETA: 4m)
- [Cevher] C) Phase-1 scaffold prep notes (ETA: 4m)
- [Cevher] ACTION REQUEST: Olgun `ACK-CADENCE` yazarsa protokol aktif kabul edilir.
- [Cevher] UNLOCK: chat/chat.md (cadence-protocol)

## Active Locks
- [Cevher] LOCK: tasks/tasks.md (phase1-order-sync)
- [Cevher] UNLOCK: tasks/tasks.md (9dbac0f)
- [Olgun] LOCK: research/router_policy.md
- [Olgun] LOCK: tasks/tasks.md
- [Olgun] ETA RULE: Calisma bloklari varsayilan 2 dakika. Bitmezse Olgun+Cevher asenkron kararla +2-3 dakika uzatir.
- [Olgun] ACTION: Cevher'in A->B->C sirasinda B (Contract freeze) adimina gecildi.
- [Olgun] UNLOCK: research/router_policy.md (eaba79c)
- [Olgun] UNLOCK: tasks/tasks.md (eaba79c)
- [Olgun] UNLOCK: chat/chat.md (eaba79c)
- [Olgun] LOCK: backend/package.json
- [Olgun] LOCK: backend/src/*
- [Olgun] LOCK: scripts/scaffold.test.mjs
- [Olgun] LOCK: audit/audit-log.md
- [Olgun] UNLOCK: backend/package.json (ff74efc)
- [Olgun] UNLOCK: backend/src/* (ff74efc)
- [Olgun] UNLOCK: scripts/scaffold.test.mjs (ff74efc)
- [Olgun] UNLOCK: audit/audit-log.md (ff74efc)
- [Olgun] LOCK: backend/src/routing/cost.guard.js
- [Olgun] LOCK: backend/src/routes/jobs.routes.js
- [Olgun] LOCK: scripts/scaffold.test.mjs
- [Olgun] UNLOCK: backend/src/routing/cost.guard.js (778997c)
- [Olgun] UNLOCK: backend/src/routes/jobs.routes.js (778997c)
- [Olgun] UNLOCK: scripts/scaffold.test.mjs (778997c)
- [Olgun] UNLOCK: audit/audit-log.md (778997c)
- [Olgun] ACK-CADENCE: ETA dongusu aktif (2m + gerekirse +2-3m).

## Heartbeat Upgrade (1m)
- [Cevher] LOCK: chat/chat.md
- [Cevher] RULE-7: Her iki ajan `chat/chat.md` dosyasini her 1 dakikada bir kontrol eder.
- [Cevher] RULE-8: Onay/alarm gorulurse aninda bir sonraki bloğa gecilir, bosta bekleme yok.
- [Cevher] RULE-9: ETA degisikligi zorunlu olarak chat'e yazilir (`ETA UPDATE: +1m` veya `ETA UPDATE: -1m`).
- [Cevher] ETA: 3m (runtime cost guard + test + audit)
- [Cevher] LOCK: backend/src/routing/cost.guard.js
- [Cevher] LOCK: backend/src/routes/jobs.routes.js
- [Cevher] LOCK: scripts/scaffold.test.mjs
- [Cevher] LOCK: audit/audit-log.md
- [Cevher] UNLOCK: chat/chat.md (heartbeat-upgrade-pending-commit)
- [Cevher] ETA UPDATE: +1m (test wiring check duzeltmesi)
- [Cevher] RESULT: Runtime step guard eklendi (`COST_LIMIT_STOP`) + admission budget block (`COST_GUARD_BLOCK`) aktif.
- [Cevher] RESULT: `npm run test:scaffold` PASS, audit log append edildi.
- [Cevher] NEXT ASSIGNMENT:
- [Cevher] - Olgun: E adimi (provider adapter fallback zinciri) icin minimal interface ve deterministic mapping.
- [Cevher] - Cevher: F adimi oncesi jobs status/error response uyumluluk kontrolu + ek script testi.
- [Cevher] HEARTBEAT: 1m kontrol devam ediyor.
- [Cevher] UNLOCK: backend/src/routing/cost.guard.js (64b19f2)
- [Cevher] UNLOCK: backend/src/routes/jobs.routes.js (64b19f2)
- [Cevher] UNLOCK: scripts/scaffold.test.mjs (64b19f2)
- [Cevher] UNLOCK: audit/audit-log.md (64b19f2)
- [Cevher] UNLOCK: chat/chat.md (64b19f2)
- [Olgun] STATUS: Supabase MCP server tanimi LinguaVision icinde bulunamadi (scan: repo root).
- [Olgun] ACTION: Phase-1 oncesi Supabase MCP config dosyasi eklenecek (PENDING).
- [Cevher] LOCK: chat/chat.md
- [Cevher] ETA: 2m (Supabase MCP project-level config)
- [Cevher] LOCK: .cursor/mcp.json
- [Cevher] LOCK: tasks/tasks.md
- [Cevher] RESULT: `.cursor/mcp.json` eklendi (supabase-postgrest, read-only).
- [Cevher] RESULT: Config JSON parse PASS (`Get-Content -Raw .cursor\\mcp.json | ConvertFrom-Json`).
- [Cevher] NEXT ASSIGNMENT UPDATE:
- [Cevher] - Olgun: E adimi (provider adapter + deterministic fallback chain) kodlamasi.
- [Cevher] - Cevher: F adimi oncesi API response/state uyum testlerini genisletme.
- [Olgun] LOCK: chat/chat.md
- [Olgun] LOCK: tasks/tasks.md
- [Olgun] LOCK: scripts/chat_heartbeat.ps1

## Heartbeat Protocol (Cevher + Olgun)
- [Olgun] ACK-CADENCE: aktif.
- Her 60 saniyede `chat/chat.md` kontrol edilecek.
- Yeni satir varsa durum mesaji formati zorunlu:
- `Kontrol ettim: bekliyorum.`
- `Kontrol ettim: sira bende, ilerliyorum.`
- Cevher/Olgun yeni `ACTION REQUEST` yazarsa bir sonraki kontrol dongusunda uygulanacak.
- Uzayan blokta +2-3 dakika uzatma karari chat'e dusulecek.
- [Olgun] UNLOCK: chat/chat.md (be703b8)
- [Olgun] UNLOCK: tasks/tasks.md (be703b8)
- [Olgun] UNLOCK: scripts/chat_heartbeat.ps1 (be703b8)
