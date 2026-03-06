import path from "path";
import { fileURLToPath } from "url";
import { JobRepository } from "./jobs/job.repo.js";
import { LocalStorage } from "./storage/local.storage.js";
import { SupabaseStorage } from "./storage/supabase.storage.js";
import { createProviderAdapter } from "./providers/provider.adapter.js";
import { createOutputCache } from "./cache/output.cache.js";
import { createSupabaseBillingAdapterFromEnv } from "./billing/billing.supabase.js";
import { createBillingStubAdapter } from "./billing/billing.stub.js";
import { createJobExecutor, createRefundReconciler } from "./jobs/job.executor.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("WORKER_CONFIG_ERROR: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are required");
}

const jobs = JobRepository.fromEnv(process.env);
const storageProvider = (process.env.LV_STORAGE_PROVIDER || "auto").toLowerCase();
const canUseSupabaseStorage = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const useSupabaseStorage =
  storageProvider === "supabase" || (storageProvider === "auto" && canUseSupabaseStorage);
const storage = useSupabaseStorage
  ? SupabaseStorage.fromEnv(process.env)
  : new LocalStorage(path.resolve(__dirname, "../storage-data"));
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
if (useSupabaseStorage) {
  console.log("LinguaVision worker storage retention=supabase(manual) buckets=pdf-input,pdf-output");
} else {
  console.warn("LinguaVision worker storage retention=local-disk(manual)");
}
if (process.env.OUTPUT_CACHE_PERSIST !== "0") {
  console.log("LinguaVision worker output-cache retention=lru-by-max-entries (no TTL janitor)");
}
const billingProvider = (process.env.BILLING_PROVIDER || "supabase").toLowerCase();
const billingAdapter =
  billingProvider === "stub" ? createBillingStubAdapter() : createSupabaseBillingAdapterFromEnv(process.env);
const stats = {
  jobs_ready_total: 0,
  jobs_failed_total: 0,
  provider_retry_total: 0,
  provider_fallback_total: 0,
  runtime_guard_block_total: 0
};

const executeJob = createJobExecutor({
  jobs,
  storage,
  providerAdapter,
  outputCache,
  cacheKeyOptions: {
    modeAProviderOrder: process.env.LV_PROVIDER_MODE_A_ORDER || "deepl,google",
    modeBProviderOrder: process.env.LV_MODE_B_PROVIDER_ORDER || "openai,groq",
    modeAOutputVersion: "mode_a_pdf_direct_v1",
    modeBOutputVersion: "mode_b_layout_v2"
  },
  featureFlags,
  billingAdapter,
  stats
});
const reconcileRefund = createRefundReconciler({
  jobs,
  storage,
  providerAdapter,
  featureFlags,
  billingAdapter,
  stats
});

const pollMs = Math.max(50, Number(process.env.LV_WORKER_POLL_MS || 250));
const workerId = process.env.LV_WORKER_ID || `worker-${process.pid}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loop() {
  console.log(
    `LinguaVision worker started poll=${pollMs}ms worker_id=${workerId} mode=db-authoritative storage=${
      useSupabaseStorage ? "supabase" : "local-disk"
    } retention=manual`
  );
  while (true) {
    try {
      const claimed = await jobs.claimNextQueued(workerId);
      if (claimed) {
        await executeJob({
          jobId: claimed.id,
          workerId,
          requestId: claimed.billing?.request_id || null
        });
        continue;
      }

      if (typeof jobs.claimNextRefundRetry === "function") {
        const refundRetry = await jobs.claimNextRefundRetry(workerId);
        if (refundRetry) {
          await reconcileRefund({
            jobId: refundRetry.id,
            workerId
          });
          continue;
        }
      }

      await sleep(pollMs);
    } catch (err) {
      console.error("worker_loop_error", err?.message || err);
      await sleep(pollMs);
    }
  }
}

await loop();
