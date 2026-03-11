import { createHash } from "crypto";
import { TranslationCache } from "./translation.cache.js";
import { createDeepLAdapter } from "./deepl.adapter.js";
import { createGoogleAdapter } from "./google.adapter.js";
import { createOpenAIAdapter } from "./openai.adapter.js";
import { createGroqAdapter } from "./groq.adapter.js";
import { createGoogleTextAdapter } from "./google-text.adapter.js";
import { createDeepLTextAdapter } from "./deepl-text.adapter.js";
import { getModeAProviderOrder, getModeBProviderOrder } from "./provider.router.js";

const KNOWN_PROVIDER_ERRORS = new Set([
  "PROVIDER_RATE_LIMIT",
  "PROVIDER_TIMEOUT",
  "PROVIDER_UPSTREAM_5XX",
  "PROVIDER_AUTH_ERROR",
  "PROVIDER_UPSTREAM_ERROR",
  "PROVIDER_UNSUPPORTED_DOCUMENT",
  "PROVIDER_MODE_UNSUPPORTED"
]);
const RETRYABLE_PROVIDER_ERRORS = new Set(["PROVIDER_RATE_LIMIT", "PROVIDER_TIMEOUT", "PROVIDER_UPSTREAM_ERROR"]);

function normalizeProviderError(code) {
  if (KNOWN_PROVIDER_ERRORS.has(code)) return code;
  return "PROVIDER_UPSTREAM_5XX";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createProviderAdapter({
  cacheMaxEntries = 200,
  cachePersistPath = null,
  disableLayoutPipeline = false,
  disableTranslationCache = false,
  modeAProviderOrder = process.env.LV_PROVIDER_MODE_A_ORDER || "deepl,google",
  modeBProviderOrder = process.env.LV_MODE_B_PROVIDER_ORDER || "openai,groq",
  deeplApiKey = process.env.DEEPL_API_KEY || "",
  deeplBaseUrl = process.env.DEEPL_API_BASE_URL || "https://api-free.deepl.com",
  googleProjectId = process.env.GOOGLE_PROJECT_ID || "",
  googleLocation = process.env.GOOGLE_LOCATION || "global",
  googleCredentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || "",
  googleServiceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "",
  googleTranslateApiKey = process.env.GOOGLE_TRANSLATE_API_KEY || "",
  openAiApiKey = process.env.OPENAI_API_KEY || "",
  groqApiKey = process.env.GROQ_API_KEY || "",
  modeAProviderRegistryOverride = null,
  modeBProviderRegistryOverride = null
} = {}) {
  const allowModeASimulatedSuccess =
    String(process.env.LV_MODE_A_ALLOW_SIMULATED_SUCCESS || "0").trim().toLowerCase() === "1";
  const transientFailureSeen = new Set();
  const translationCache = new TranslationCache({
    maxEntries: cacheMaxEntries,
    persistPath: cachePersistPath
  });
  const deepL = createDeepLAdapter({
    apiKey: deeplApiKey,
    baseUrl: deeplBaseUrl
  });
  const google = createGoogleAdapter({
    projectId: googleProjectId,
    location: googleLocation,
    credentialsPath: googleCredentialsPath,
    credentialsJson: googleServiceAccountJson || null
  });
  const providerRegistry = modeAProviderRegistryOverride || {
    deepl: deepL,
    google
  };
  const openAi = createOpenAIAdapter({ apiKey: openAiApiKey });
  const groq = createGroqAdapter({ apiKey: groqApiKey });
  const googleText = createGoogleTextAdapter({ apiKey: googleTranslateApiKey });
  const deepLText = createDeepLTextAdapter({ apiKey: deeplApiKey, baseUrl: deeplBaseUrl });
  const modeBProviderRegistry = modeBProviderRegistryOverride || {
    deepl_text: deepLText,
    google_text: googleText,
    openai: openAi,
    groq
  };
  const configuredModeAProviders = getModeAProviderOrder(modeAProviderOrder).filter(
    (name) => providerRegistry[name]?.enabled
  );
  const configuredModeBProviders = getModeBProviderOrder(modeBProviderOrder).filter(
    (name) => modeBProviderRegistry[name]?.enabled
  );

  function buildModeBRoutingSnapshot() {
    const rawOrder = getModeBProviderOrder(modeBProviderOrder);
    const candidates = [];
    const exclusions = [];
    for (const name of rawOrder) {
      const provider = modeBProviderRegistry[name];
      if (provider?.enabled) {
        candidates.push(name);
      } else {
        exclusions.push({
          provider: name,
          reason: "provider_disabled_or_missing_credentials"
        });
      }
    }
    return {
      configured_order: rawOrder,
      resolved_order: candidates.length ? candidates : ["openai", "groq"],
      exclusions,
      selection_reason: candidates.length
        ? "env_order_filtered_by_enabled_providers"
        : "fallback_default_due_to_no_enabled_provider"
    };
  }
  const perf = {
    provider_calls_total: 0,
    provider_success_total: 0,
    provider_fail_total: 0,
    provider_latency_total_ms: 0
  };

  function makeCacheKey({ inputBuffer, tier, mode, sourceLang, targetLang, providerKey = "simulated" }) {
    const h = createHash("sha256");
    h.update(inputBuffer);
    h.update(`|${tier}|${mode}|${sourceLang || ""}|${targetLang || ""}|${providerKey}`);
    return h.digest("hex");
  }

  return {
    getRoutingSnapshot() {
      const modeASnapshot = {
        configured_order: getModeAProviderOrder(modeAProviderOrder),
        resolved_order: configuredModeAProviders.slice(),
        has_enabled_provider: configuredModeAProviders.length > 0
      };
      return {
        mode_a: modeASnapshot,
        mode_b: buildModeBRoutingSnapshot()
      };
    },
    async translateDocument({
      inputBuffer,
      executionMode = "MODE_A",
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
      const normalizedExecutionMode = String(executionMode || "MODE_A").toUpperCase();
      if (normalizedExecutionMode !== "MODE_A") {
        perf.provider_fail_total += 1;
        perf.provider_latency_total_ms += Date.now() - startedAt;
        return { ok: false, error: "PROVIDER_MODE_UNSUPPORTED", tier };
      }
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

      const providerAttempts = [];
      const hasModeAProvider = configuredModeAProviders.length > 0;
      if (hasModeAProvider && !hasSimulationControls) {
        let fallbackUsed = false;
        for (let i = 0; i < configuredModeAProviders.length; i++) {
          const providerName = configuredModeAProviders[i];
          const provider = providerRegistry[providerName];
          const pStartedAt = Date.now();
          const modeACacheKey = makeCacheKey({
            inputBuffer,
            tier,
            mode,
            sourceLang,
            targetLang,
            providerKey: providerName
          });
          if (!disableTranslationCache) {
            const cached = translationCache.get(modeACacheKey);
            if (cached) {
              perf.provider_success_total += 1;
              perf.provider_latency_total_ms += Date.now() - startedAt;
              return {
                ok: true,
                tier,
                mode,
                outputBuffer: cached.outputBuffer,
                layoutMetrics: cached.layoutMetrics,
                cacheHit: true,
                provider_used: providerName,
                provider_attempts: [
                  ...providerAttempts,
                  {
                    provider: providerName,
                    status: "success",
                    attempt_no: i + 1,
                    duration_ms: Date.now() - pStartedAt,
                    cache_hit: true
                  }
                ]
              };
            }
          }

          const result = await provider.translatePdf({
            inputBuffer,
            sourceLang,
            targetLang
          });
          if (result.ok && result.outputBuffer) {
            const layoutMetrics = {
              anchor_count: 0,
              chunk_count: 1,
              missing_anchor_count: 0,
              overflow_count: 0,
              moved_block_count: 0,
              reflow_strategy: `mode_a_${providerName}_pdf_direct`
            };
            if (!disableTranslationCache) {
              translationCache.set(modeACacheKey, {
                outputBuffer: result.outputBuffer,
                layoutMetrics
              });
            }
            perf.provider_success_total += 1;
            perf.provider_latency_total_ms += Date.now() - startedAt;
            return {
              ok: true,
              tier,
              mode,
              outputBuffer: result.outputBuffer,
              layoutMetrics,
              cacheHit: false,
              provider_used: providerName,
              provider_attempts: [
                ...providerAttempts,
                {
                  provider: providerName,
                  status: "success",
                  attempt_no: i + 1,
                  duration_ms: Date.now() - pStartedAt,
                  cache_hit: false
                }
              ]
            };
          }

          const errorCode = normalizeProviderError(result.error || "PROVIDER_UPSTREAM_ERROR");
          providerAttempts.push({
            provider: providerName,
            status: "failed",
            attempt_no: i + 1,
            error_code: errorCode,
            duration_ms: Date.now() - pStartedAt
          });
          const canFallback = !fallbackUsed && i < configuredModeAProviders.length - 1;
          if (canFallback && RETRYABLE_PROVIDER_ERRORS.has(errorCode)) {
            fallbackUsed = true;
            continue;
          }
          perf.provider_fail_total += 1;
          perf.provider_latency_total_ms += Date.now() - startedAt;
          return {
            ok: false,
            error: errorCode,
            tier,
            provider_used: providerName,
            provider_attempts: providerAttempts
          };
        }
      }

      if (!allowModeASimulatedSuccess) {
        perf.provider_fail_total += 1;
        perf.provider_latency_total_ms += Date.now() - startedAt;
        return {
          ok: false,
          error: "PROVIDER_AUTH_ERROR",
          tier,
          provider_used: configuredModeAProviders[configuredModeAProviders.length - 1] || null,
          provider_attempts: providerAttempts
        };
      }

      const cacheKey = makeCacheKey({
        inputBuffer,
        tier,
        mode,
        sourceLang,
        targetLang,
        providerKey: "simulated"
      });
      if (!disableTranslationCache && !hasSimulationControls) {
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
            cacheHit: true,
            provider_used: "simulated",
            provider_attempts: [{ provider: "simulated", status: "success", attempt_no: 1, cache_hit: true }]
          };
        }
      }

      const simulatedLayoutMetrics = {
        anchor_count: 0,
        chunk_count: 1,
        missing_anchor_count: Math.max(0, Number(simulateLayoutMissingAnchorCount || 0)),
        overflow_count: Math.max(0, Number(simulateLayoutOverflowCount || 0)),
        moved_block_count: 0,
        reflow_strategy: "mode_a_simulated_pdf_direct"
      };
      if (!disableTranslationCache && !hasSimulationControls) {
        translationCache.set(cacheKey, {
          outputBuffer: inputBuffer,
          layoutMetrics: simulatedLayoutMetrics
        });
      }
      perf.provider_success_total += 1;
      perf.provider_latency_total_ms += Date.now() - startedAt;
      return {
        ok: true,
        tier,
        mode,
        outputBuffer: inputBuffer,
        layoutMetrics: simulatedLayoutMetrics,
        cacheHit: false,
        provider_used: "simulated",
        provider_attempts: [{ provider: "simulated", status: "success", attempt_no: 1, cache_hit: false }]
      };
    },
    getCacheMetrics() {
      const avgLatency =
        perf.provider_calls_total > 0 ? Math.round(perf.provider_latency_total_ms / perf.provider_calls_total) : 0;
      return {
        ...translationCache.metrics(),
        ...perf,
        cache_disabled: Boolean(disableTranslationCache),
        layout_pipeline_disabled: Boolean(disableLayoutPipeline),
        provider_latency_avg_ms: avgLatency
      };
    },
    async translateTextChunks({
      chunks,
      sourceLang = null,
      targetLang,
      executionMode = "MODE_B",
      simulateFailCode = null
    }) {
      const normalizedExecutionMode = String(executionMode || "MODE_B").toUpperCase();
      if (normalizedExecutionMode !== "MODE_B") {
        return { ok: false, error: "PROVIDER_MODE_UNSUPPORTED" };
      }
      const orderedChunks = (chunks || []).slice().sort((a, b) => a.index - b.index);
      if (orderedChunks.length === 0) {
        return { ok: false, error: "PROVIDER_UPSTREAM_ERROR" };
      }
      if (simulateFailCode) {
        return { ok: false, error: normalizeProviderError(simulateFailCode) };
      }

      const routing = buildModeBRoutingSnapshot();
      const providersToTry = routing.resolved_order;
      const attempts = [];
      let escalations = 0;
      const maxEscalations = Math.max(0, providersToTry.length - 1);
      let previousError = null;

      for (let i = 0; i < providersToTry.length; i++) {
        const providerName = providersToTry[i];
        const provider = modeBProviderRegistry[providerName];
        const attemptIndex = i + 1;
        const reasonForAttempt =
          i === 0
            ? "primary_provider_in_resolved_order"
            : `fallback_after_${String(previousError || "unknown_error").toLowerCase()}`;
        if (!provider?.enabled) {
          attempts.push({
            provider: providerName,
            attempt_no: attemptIndex,
            attempt_index: attemptIndex,
            reason_for_attempt: reasonForAttempt,
            status: "failed",
            error_code: "PROVIDER_AUTH_ERROR"
          });
          previousError = "PROVIDER_AUTH_ERROR";
          continue;
        }

        const result = await provider.translateTextChunks({
          chunks: orderedChunks,
          sourceLang,
          targetLang
        });
        if (result?.ok && Array.isArray(result.translatedChunks)) {
          return {
            ok: true,
            provider_used: providerName,
            translatedChunks: result.translatedChunks.slice().sort((a, b) => a.index - b.index),
            routing,
            provider_attempts: [
              ...attempts,
              {
                provider: providerName,
                attempt_no: attemptIndex,
                attempt_index: attemptIndex,
                reason_for_attempt: reasonForAttempt,
                status: "success"
              }
            ],
            fallback_used: escalations > 0
          };
        }

        const errorCode = normalizeProviderError(result?.error || "PROVIDER_UPSTREAM_ERROR");
        attempts.push({
          provider: providerName,
          attempt_no: attemptIndex,
          attempt_index: attemptIndex,
          reason_for_attempt: reasonForAttempt,
          status: "failed",
          error_code: errorCode
        });
        previousError = errorCode;

        if (i < providersToTry.length - 1 && RETRYABLE_PROVIDER_ERRORS.has(errorCode) && escalations < maxEscalations) {
          escalations += 1;
          continue;
        }
        return {
          ok: false,
          error: errorCode,
          provider_used: providerName,
          routing,
          provider_attempts: attempts
        };
      }

      return {
        ok: false,
        error: "PROVIDER_AUTH_ERROR",
        provider_used: providersToTry[providersToTry.length - 1] || null,
        routing,
        provider_attempts: attempts
      };
    }
  };
}
