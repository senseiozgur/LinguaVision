import { runLayoutPipeline } from "../pdf/layout.pipeline.js";
import { createHash } from "crypto";
import { TranslationCache } from "./translation.cache.js";

const KNOWN_PROVIDER_ERRORS = new Set([
  "PROVIDER_RATE_LIMIT",
  "PROVIDER_TIMEOUT",
  "PROVIDER_UPSTREAM_5XX"
]);

function normalizeProviderError(code) {
  if (KNOWN_PROVIDER_ERRORS.has(code)) return code;
  return "PROVIDER_UPSTREAM_5XX";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createProviderAdapter({ cacheMaxEntries = 200, cachePersistPath = null } = {}) {
  const transientFailureSeen = new Set();
  const translationCache = new TranslationCache({
    maxEntries: cacheMaxEntries,
    persistPath: cachePersistPath
  });
  const perf = {
    provider_calls_total: 0,
    provider_success_total: 0,
    provider_fail_total: 0,
    provider_latency_total_ms: 0
  };

  function makeCacheKey({ inputBuffer, tier, mode, sourceLang, targetLang }) {
    const h = createHash("sha256");
    h.update(inputBuffer);
    h.update(`|${tier}|${mode}|${sourceLang || ""}|${targetLang || ""}`);
    return h.digest("hex");
  }

  return {
    async translateDocument({
      inputBuffer,
      tier,
      mode,
      simulateFailTier = null,
      simulateFailTiers = [],
      simulateFailCode = "PROVIDER_TIMEOUT",
      simulateRetryOnceTiers = [],
      simulateLayoutMissingAnchorCount = 0,
      simulateLayoutOverflowCount = 0,
      simulateProviderLatencyMs = 0,
      providerTimeoutMs = 2500,
      jobId = null,
      sourceLang = null,
      targetLang = null
    }) {
      const startedAt = Date.now();
      perf.provider_calls_total += 1;
      const failSet = new Set(simulateFailTiers || []);
      const retryOnceSet = new Set(simulateRetryOnceTiers || []);
      const hasSimulationControls = Boolean(simulateFailTier) || failSet.size > 0 || retryOnceSet.size > 0;
      const shouldFail = (simulateFailTier && simulateFailTier === tier) || failSet.has(tier);
      const transientKey = `${jobId || "global"}:${tier}`;
      const shouldFailOnce = retryOnceSet.has(tier) && !transientFailureSeen.has(transientKey);
      if (shouldFail) {
        const code = normalizeProviderError(simulateFailCode);
        perf.provider_fail_total += 1;
        perf.provider_latency_total_ms += Date.now() - startedAt;
        return { ok: false, error: code, tier };
      }
      if (shouldFailOnce) {
        transientFailureSeen.add(transientKey);
        perf.provider_fail_total += 1;
        perf.provider_latency_total_ms += Date.now() - startedAt;
        return { ok: false, error: normalizeProviderError("PROVIDER_TIMEOUT"), tier };
      }

      if (simulateProviderLatencyMs > 0) {
        await sleep(simulateProviderLatencyMs);
      }
      if (simulateProviderLatencyMs > providerTimeoutMs) {
        perf.provider_fail_total += 1;
        perf.provider_latency_total_ms += Date.now() - startedAt;
        return { ok: false, error: "PROVIDER_TIMEOUT", tier };
      }

      const cacheKey = makeCacheKey({ inputBuffer, tier, mode, sourceLang, targetLang });
      if (!hasSimulationControls) {
        const cached = translationCache.get(cacheKey);
        if (cached) {
          perf.provider_success_total += 1;
          perf.provider_latency_total_ms += Date.now() - startedAt;
          return {
            ok: true,
            tier,
            mode,
            outputBuffer: cached.outputBuffer,
            layoutMetrics: cached.layoutMetrics,
            cacheHit: true
          };
        }
      }

      const pipeline = runLayoutPipeline({ inputBuffer, mode });
      if (simulateLayoutMissingAnchorCount > 0) {
        pipeline.layoutMetrics.missing_anchor_count = Number(simulateLayoutMissingAnchorCount);
      }
      if (simulateLayoutOverflowCount > 0) {
        pipeline.layoutMetrics.overflow_count = Number(simulateLayoutOverflowCount);
      }
      if (!hasSimulationControls) {
        translationCache.set(cacheKey, {
          outputBuffer: pipeline.outputBuffer,
          layoutMetrics: pipeline.layoutMetrics
        });
      }
      perf.provider_success_total += 1;
      perf.provider_latency_total_ms += Date.now() - startedAt;
      return {
        ok: true,
        tier,
        mode,
        outputBuffer: pipeline.outputBuffer,
        layoutMetrics: pipeline.layoutMetrics,
        cacheHit: false
      };
    },
    getCacheMetrics() {
      const avgLatency =
        perf.provider_calls_total > 0 ? Math.round(perf.provider_latency_total_ms / perf.provider_calls_total) : 0;
      return {
        ...translationCache.metrics(),
        ...perf,
        provider_latency_avg_ms: avgLatency
      };
    }
  };
}
