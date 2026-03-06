import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import express from "express";
import { createJobsRouter } from "./routes/jobs.routes.js";
import { JobStore } from "./jobs/job.store.js";
import { JobRepository } from "./jobs/job.repo.js";
import { JobQueue } from "./jobs/job.queue.js";
import { LocalStorage } from "./storage/local.storage.js";
import { SupabaseStorage } from "./storage/supabase.storage.js";
import { createProviderAdapter } from "./providers/provider.adapter.js";
import { createOutputCache } from "./cache/output.cache.js";
import { createRateLimitStore } from "./security/rate-limit.store.js";
import { createSupabaseBillingAdapterFromEnv } from "./billing/billing.supabase.js";
import { createBillingStubAdapter } from "./billing/billing.stub.js";
import { createJobExecutor, createRefundReconciler } from "./jobs/job.executor.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use((req, res, next) => {
  const requestId = (req.get("x-request-id") || "").trim() || crypto.randomUUID();
  req.requestId = requestId;
  res.locals.request_id = requestId;
  res.setHeader("x-request-id", requestId);
  const startedAt = Date.now();

  res.on("finish", () => {
    const event = {
      request_id: requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      job_id: res.locals.job_id || null,
      billing_request_id: res.locals.billing_request_id || null,
      duration_ms: Date.now() - startedAt
    };
    console.log(JSON.stringify(event));
  });

  next();
});

const jobs =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? JobRepository.fromEnv(process.env)
    : new JobStore();
const storageProvider = (process.env.LV_STORAGE_PROVIDER || "auto").toLowerCase();
const canUseSupabaseStorage = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const useSupabaseStorage =
  storageProvider === "supabase" || (storageProvider === "auto" && canUseSupabaseStorage);
const storage = useSupabaseStorage
  ? SupabaseStorage.fromEnv(process.env)
  : new LocalStorage(path.resolve(__dirname, "../storage-data"));
if (useSupabaseStorage) {
  console.log("LinguaVision storage mode=supabase buckets=pdf-input,pdf-output retention=manual");
} else {
  console.log("LinguaVision storage mode=local-disk retention=manual");
}
const cacheMaxEntries = Number(process.env.TRANSLATION_CACHE_MAX || 200);
const cachePersistPath =
  process.env.TRANSLATION_CACHE_PERSIST === "0"
    ? null
    : path.resolve(__dirname, "../storage-data/translation-cache.json");
const featureFlags = {
  disableLayoutPipeline: process.env.DISABLE_LAYOUT_PIPELINE === "1",
  disableTranslationCache: process.env.DISABLE_TRANSLATION_CACHE === "1",
  disableStrictQualityGate: process.env.DISABLE_STRICT_QUALITY_GATE === "1"
};
const providerAdapter = createProviderAdapter({
  cacheMaxEntries,
  cachePersistPath,
  disableLayoutPipeline: featureFlags.disableLayoutPipeline,
  disableTranslationCache: featureFlags.disableTranslationCache
});
const outputCachePersistPath =
  process.env.OUTPUT_CACHE_PERSIST === "0" ? null : path.resolve(__dirname, "../storage-data/output-cache.json");
const outputCache = createOutputCache({
  maxEntries: Number(process.env.OUTPUT_CACHE_MAX || cacheMaxEntries),
  persistPath: outputCachePersistPath
});
const rateLimitStore = createRateLimitStore({
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  preferShared: process.env.LV_RATE_LIMIT_SHARED !== "0"
});
console.log(`LinguaVision rate-limit mode=${rateLimitStore.metrics().rate_limit_mode}`);
if (process.env.LV_RATE_LIMIT_SHARED !== "0") {
  console.log("LinguaVision rate-limit shared-preferred=1 (falls back to memory if rpc unavailable)");
}
if (process.env.LV_METRICS_API_KEY) {
  console.log("LinguaVision metrics access mode=internal-key");
} else if (process.env.LV_METRICS_ALLOW_PRIMARY_KEY === "0") {
  console.log("LinguaVision metrics access mode=disabled-until-metrics-key");
} else {
  console.warn("LinguaVision metrics access uses primary API key fallback; set LV_METRICS_API_KEY to harden");
}
if (!useSupabaseStorage) {
  console.warn("LinguaVision storage retention remains manual in local-disk mode");
}
if (process.env.OUTPUT_CACHE_PERSIST !== "0") {
  console.log("LinguaVision output-cache retention=lru-by-max-entries (no TTL janitor)");
}
const billingProvider = (process.env.BILLING_PROVIDER || "supabase").toLowerCase();
const billingAdapter =
  billingProvider === "stub" ? createBillingStubAdapter() : createSupabaseBillingAdapterFromEnv(process.env);

const shared = {
  jobs,
  storage,
  providerAdapter,
  outputCache,
  rateLimitStore,
  cacheKeyOptions: {
    modeAProviderOrder: process.env.LV_PROVIDER_MODE_A_ORDER || "deepl,google",
    modeBProviderOrder: process.env.LV_MODE_B_PROVIDER_ORDER || "openai,groq",
    modeAOutputVersion: "mode_a_pdf_direct_v1",
    modeBOutputVersion: "mode_b_layout_v2"
  },
  featureFlags,
  billingAdapter,
  apiKey: process.env.LV_API_KEY || "",
  metricsEnabled: process.env.LV_ENABLE_METRICS !== "0",
  metricsAllowPrimaryKey: process.env.LV_METRICS_ALLOW_PRIMARY_KEY !== "0",
  metricsApiKey: process.env.LV_METRICS_API_KEY || ""
};
const executeJob = createJobExecutor(shared);
const reconcileRefund = createRefundReconciler(shared);
const embeddedWorkerDisabled = process.env.LV_DISABLE_EMBEDDED_WORKER === "1";
if (!embeddedWorkerDisabled) {
  const embeddedWorkerId = `api-embedded-${process.pid}`;
  const embeddedPollMs = Math.max(250, Number(process.env.LV_WORKER_POLL_MS || 250));
  console.log(`LinguaVision embedded worker enabled worker_id=${embeddedWorkerId}`);
  const queue = new JobQueue({
    processFn: async (payload) => {
      await executeJob({ ...payload, workerId: embeddedWorkerId });
    }
  });
  queue.start();
  shared.queue = queue;

  let refundLoopBusy = false;
  setInterval(async () => {
    if (refundLoopBusy) return;
    refundLoopBusy = true;
    try {
      if (typeof jobs.claimNextRefundRetry === "function") {
        const refundRetry = await jobs.claimNextRefundRetry(embeddedWorkerId);
        if (refundRetry) {
          await reconcileRefund({
            jobId: refundRetry.id,
            workerId: embeddedWorkerId
          });
        }
      }
    } catch {
      // reconciliation errors are persisted by adapter/repository path
    } finally {
      refundLoopBusy = false;
    }
  }, embeddedPollMs);
} else {
  shared.queue = null;
}
app.use("/jobs", createJobsRouter(shared));

const port = process.env.PORT || 8787;
app.listen(port, () => {
  console.log(`LinguaVision backend listening on :${port}`);
});
