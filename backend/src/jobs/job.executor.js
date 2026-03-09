import { estimateStepUnits, validateRuntimeStep } from "../routing/cost.guard.js";
import { getTierMultiplier, planRoute } from "../providers/provider.router.js";
import { BillingError, toSafeBillingErrorCode } from "../billing/billing.adapter.js";
import { extractPdfTextBlocks } from "../pdf/text.extractor.js";
import { chunkTextBlocks } from "../pdf/chunker.js";
import { buildLayoutAwareTextPdf } from "../pdf/text.output.js";
import { buildModeBLayoutModel } from "../pdf/layout.ir.js";
import { buildOutputCacheKey, shortCacheKey } from "../cache/cache.key.js";
import { createEngineAdapter } from "../pdf/engine.adapter.js";

const REFUND_RETRY_SCHEDULE_SECONDS = [60, 300, 1800, 7200, 43200, 86400];

function mapErrorToUxHint(errorCode) {
  if (errorCode === "INPUT_LIMIT_EXCEEDED") return "plan_limit_upgrade";
  if (errorCode === "COST_GUARD_BLOCK") return "cost_limit_reduce_scope";
  if (errorCode === "COST_LIMIT_STOP") return "cost_limit_partial_result";
  if (errorCode && errorCode.startsWith("BILLING_")) return "retry_later";
  if (errorCode === "LAYOUT_QUALITY_GATE_BLOCK") return "switch_mode_or_fix_pdf";
  if (errorCode && errorCode.startsWith("PROVIDER_")) return "retry_or_fallback";
  return "review_job_error";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function getNextRefundRetryAt(retryCount) {
  const seconds = REFUND_RETRY_SCHEDULE_SECONDS[retryCount - 1];
  if (!seconds) return null;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function deriveBillingErrorCode(err) {
  if (err instanceof BillingError) return err.code;
  return toSafeBillingErrorCode(err);
}

function normalizeEngineErrorCode(code) {
  const value = String(code || "").toUpperCase();
  if (value === "PROVIDER_TIMEOUT") return value;
  if (value === "PROVIDER_RATE_LIMIT") return value;
  if (value === "PROVIDER_AUTH_ERROR") return value;
  if (value === "PROVIDER_UPSTREAM_ERROR") return value;
  return "PROVIDER_UPSTREAM_ERROR";
}

export function createJobExecutor(deps) {
  const featureFlags = deps.featureFlags || {
    disableLayoutPipeline: false,
    disableTranslationCache: false,
    disableStrictQualityGate: false
  };
  const stats = deps.stats || {};
  deps.stats = stats;
  const engineAdapter = deps.engineAdapter || createEngineAdapter();

  function bump(key) {
    stats[key] = (stats[key] || 0) + 1;
  }

  function bumpProviderUsage(providerName) {
    const safe = String(providerName || "unknown").toLowerCase().replace(/[^a-z0-9_]/g, "_");
    bump(`provider_usage_${safe}_total`);
  }

  async function scheduleRefundRetry({
    job,
    workerId,
    runRequestId,
    billingRequestId,
    chargedUnits,
    causeErrorCode,
    refundErrorCode
  }) {
    const existingBilling = job.billing || {};
    const nextRetryCount = Number(existingBilling.refund_retry_count || 0) + 1;
    const nextRetryAt = getNextRefundRetryAt(nextRetryCount);
    const now = nowIso();
    const nextState = nextRetryAt ? "REFUND_PENDING" : "REFUND_FAILED_FINAL";

    await deps.jobs.update(job.id, {
      billing: {
        ...existingBilling,
        request_id: runRequestId,
        billing_request_id: billingRequestId || existingBilling.billing_request_id || null,
        charged_units: Number(chargedUnits || existingBilling.charged_units || 0),
        charged: true,
        refunded: false,
        charge_state: nextState,
        refund_retry_count: nextRetryCount,
        next_refund_retry_at: nextRetryAt,
        last_refund_error_code: refundErrorCode || causeErrorCode || null,
        refund_last_attempt_at: now
      }
    });

    await deps.jobs.appendJobEvent(job.id, job.owner_id, "BILLING_REFUND_FAILED", {
      worker_id: workerId || null,
      request_id: runRequestId,
      billing_request_id: billingRequestId || existingBilling.billing_request_id || null,
      error_code: refundErrorCode || causeErrorCode || null,
      refund_retry_count: nextRetryCount
    });

    if (nextRetryAt) {
      bump("billing_refund_retry_scheduled_total");
      await deps.jobs.appendJobEvent(job.id, job.owner_id, "BILLING_REFUND_RETRY_SCHEDULED", {
        worker_id: workerId || null,
        request_id: runRequestId,
        billing_request_id: billingRequestId || existingBilling.billing_request_id || null,
        refund_retry_count: nextRetryCount,
        next_refund_retry_at: nextRetryAt
      });
    }
  }

  async function attemptRefund({
    jobId,
    workerId,
    runRequestId,
    billingRequestId,
    chargedUnits,
    reasonCode
  }) {
    const job = await deps.jobs.get(jobId);
    if (!job) return { ok: false, error: "job_not_found" };
    const billing = job.billing || {};
    const attemptNo = Number(billing.refund_retry_count || 0) + 1;
    const startedAt = Date.now();

    await deps.jobs.appendJobEvent(job.id, job.owner_id, "BILLING_REFUND_STARTED", {
      worker_id: workerId || null,
      request_id: runRequestId,
      billing_request_id: billingRequestId || billing.billing_request_id || null,
      refund_retry_count: attemptNo,
      reason: reasonCode || null
    });

    try {
      const refundResult = await deps.billingAdapter.refund({
        user_id: job.user_id || null,
        job_id: job.id,
        request_id: runRequestId,
        billing_request_id: billingRequestId || billing.billing_request_id,
        units: Number(chargedUnits || billing.charged_units || 0),
        reason: reasonCode,
        meta: {
          mode: job.mode || null,
          package_name: job.package_name || null
        }
      });

      const now = nowIso();
      await deps.jobs.update(job.id, {
        billing: {
          ...billing,
          request_id: runRequestId,
          billing_request_id: billingRequestId || billing.billing_request_id || null,
          charged_units: Number(chargedUnits || billing.charged_units || 0),
          charged: true,
          refunded: true,
          charge_state: "REFUNDED",
          next_refund_retry_at: null,
          last_refund_error_code: null,
          refund_last_attempt_at: now
        }
      });
      await deps.jobs.appendJobEvent(job.id, job.owner_id, "BILLING_REFUNDED", {
        worker_id: workerId || null,
        request_id: runRequestId,
        billing_request_id: billingRequestId || billing.billing_request_id || null,
        refund_retry_count: attemptNo,
        duration_ms: Date.now() - startedAt,
        already_refunded: Boolean(refundResult.already_refunded)
      });
      return { ok: true };
    } catch (err) {
      const refundErrorCode = deriveBillingErrorCode(err);
      await scheduleRefundRetry({
        job,
        workerId,
        runRequestId,
        billingRequestId: billingRequestId || billing.billing_request_id || null,
        chargedUnits: Number(chargedUnits || billing.charged_units || 0),
        causeErrorCode: reasonCode,
        refundErrorCode
      });
      return { ok: false, error: refundErrorCode };
    }
  }

  return async function executeJob({
    jobId,
    workerId,
    requestId,
    simulateFailBeforeProvider,
    simulateFailTier,
    simulateFailTiers,
    simulateFailCode,
    simulateRetryOnceTiers,
    simulateLayoutMissingAnchorCount,
    simulateLayoutOverflowCount,
    simulateProviderLatencyMs,
    providerTimeoutMs,
    workerDelayMs
  }) {
    const job = await deps.jobs.get(jobId);
    if (!job) return { ok: false, error: "job_not_found" };
    const runRequestId = requestId || job.billing?.request_id;
    if (!runRequestId) return { ok: false, error: "invalid_input" };

    await deps.jobs.update(job.id, {
      status: "PROCESSING",
      progress_pct: 30,
      billing: { ...job.billing, request_id: runRequestId }
    });
    await deps.jobs.appendJobEvent(job.id, job.owner_id, "JOB_PROCESSING_STARTED", {
      request_id: runRequestId,
      worker_id: workerId || null
    });

    if (workerDelayMs > 0) {
      await sleep(workerDelayMs);
    }

    const inBytes = await deps.storage.readFile(job.input_file_path);
    const executionMode = (job.provider_mode || "MODE_A").toUpperCase();
    await deps.jobs.appendJobEvent(job.id, job.owner_id, executionMode === "MODE_B" ? "MODE_B_SELECTED" : "MODE_A_SELECTED", {
      worker_id: workerId || null,
      request_id: runRequestId,
      mode: executionMode
    });
    const route = planRoute({ packageName: job.package_name || "free", mode: job.mode || "readable" });
    const baseStepUnits = estimateStepUnits({ fileSizeBytes: inBytes.length, mode: route.mode });
    const spentUnits = Number(job.billing?.charged_units || 0);
    const unitsToCharge = Math.max(1, baseStepUnits);
    const cacheKeyOptions = deps.cacheKeyOptions || {
      modeAProviderOrder: process.env.LV_PROVIDER_MODE_A_ORDER || "deepl,google",
      modeBProviderOrder: process.env.LV_MODE_B_PROVIDER_ORDER || "openai,groq",
      modeAOutputVersion: "mode_a_pdf_direct_v1",
      modeBOutputVersion: "mode_b_layout_v2"
    };
    const outputCache = deps.outputCache || null;
    const providerFamily = executionMode === "MODE_B" ? cacheKeyOptions.modeBProviderOrder : cacheKeyOptions.modeAProviderOrder;
    const modeBEngine = String(process.env.LV_MODE_B_ENGINE || "custom").toLowerCase() === "external" ? "external" : "custom";
    const outputStrategyVersion =
      executionMode === "MODE_B"
        ? modeBEngine === "external"
          ? `${cacheKeyOptions.modeBOutputVersion}_external`
          : cacheKeyOptions.modeBOutputVersion
        : cacheKeyOptions.modeAOutputVersion;
    const cacheBypass =
      Boolean(simulateFailBeforeProvider) ||
      Boolean(simulateFailTier) ||
      Boolean(simulateFailTiers?.length) ||
      Boolean(simulateRetryOnceTiers?.length) ||
      Number(simulateProviderLatencyMs || 0) > 0 ||
      Number(simulateLayoutMissingAnchorCount || 0) > 0 ||
      Number(simulateLayoutOverflowCount || 0) > 0;
    const cacheDescriptor = buildOutputCacheKey({
      inputBuffer: inBytes,
      ownerId: job.owner_id || "",
      sourceLang: job.source_lang || "",
      targetLang: job.target_lang || "",
      providerMode: executionMode,
      providerFamily,
      outputStrategyVersion,
      routeMode: route.mode
    });
    let cacheKey = cacheDescriptor.key;
    const cacheKeyShort = shortCacheKey(cacheKey);
    let lastError = "ROUTER_NO_FALLBACK_PATH";
    let chargeResult =
      job.billing?.charged && job.billing?.billing_request_id
        ? {
            billing_request_id: job.billing.billing_request_id,
            charged_units: Number(job.billing.charged_units || unitsToCharge),
            already_charged: true
          }
        : null;
    let firstProviderRequestAttempted = false;

    if (outputCache && !cacheBypass) {
      bump("cache_lookup_total");
      await deps.jobs.appendJobEvent(job.id, job.owner_id, "CACHE_LOOKUP", {
        request_id: runRequestId,
        worker_id: workerId || null,
        mode: executionMode,
        cache_key: cacheKeyShort,
        cache_scope: cacheDescriptor.cacheScope
      });
      const cachedOutput = outputCache.get(cacheKey);
      if (cachedOutput?.outputBuffer) {
        bump("cache_hit_total");
        await deps.jobs.appendJobEvent(job.id, job.owner_id, "CACHE_HIT", {
          request_id: runRequestId,
          worker_id: workerId || null,
          mode: executionMode,
          provider: cachedOutput?.meta?.provider_used || null,
          cache_key: cacheKeyShort,
          cache_scope: cacheDescriptor.cacheScope
        });
        const outPath = await deps.storage.saveOutput(job.id, cachedOutput.outputBuffer);
        await deps.jobs.appendJobEvent(job.id, job.owner_id, "CACHE_REUSED_OUTPUT", {
          request_id: runRequestId,
          worker_id: workerId || null,
          mode: executionMode,
          cache_key: cacheKeyShort,
          cache_scope: cacheDescriptor.cacheScope
        });
        await deps.jobs.update(job.id, {
          status: "READY",
          progress_pct: 100,
          output_file_path: outPath,
          provider_used: cachedOutput?.meta?.provider_used || null,
          selected_tier: cachedOutput?.meta?.selected_tier || null,
          layout_metrics: cachedOutput.layoutMetrics || null,
          translation_cache_hit: true,
          quality_gate_passed: cachedOutput?.meta?.quality_gate_passed ?? null,
          quality_gate_reason: null,
          cost_delta_units: Number(cachedOutput?.meta?.cost_delta_units || 0),
          ux_hint: null,
          billing: {
            ...job.billing,
            request_id: runRequestId,
            charge_state: job.billing?.charged ? "CHARGED" : "NOT_CHARGED"
          }
        });
        await deps.jobs.appendJobEvent(job.id, job.owner_id, "JOB_READY", {
          selected_tier: cachedOutput?.meta?.selected_tier || null
        });
        bump("jobs_ready_total");
        return { ok: true };
      }
      bump("cache_miss_total");
      await deps.jobs.appendJobEvent(job.id, job.owner_id, "CACHE_MISS", {
        request_id: runRequestId,
        worker_id: workerId || null,
        mode: executionMode,
        cache_key: cacheKeyShort,
        cache_scope: cacheDescriptor.cacheScope
      });
    }

    if (executionMode === "MODE_B") {
      if (simulateFailBeforeProvider) {
        lastError = "PROVIDER_PRECHECK_FAILED";
      } else {
        if (!chargeResult) {
          const chargeStartedAt = Date.now();
          await deps.jobs.appendJobEvent(job.id, job.owner_id, "BILLING_CHARGE_STARTED", {
            worker_id: workerId || null,
            request_id: runRequestId
          });
          try {
            chargeResult = await deps.billingAdapter.charge({
              user_id: job.user_id || null,
              job_id: job.id,
              request_id: runRequestId,
              units: unitsToCharge,
              meta: {
                mode: route.mode,
                package_name: route.packageName,
                source_lang: job.source_lang || null,
                target_lang: job.target_lang || null
              }
            });
            await deps.jobs.update(job.id, {
              billing: {
                ...job.billing,
                request_id: runRequestId,
                billing_request_id: chargeResult.billing_request_id,
                charged_units: Number(chargeResult.charged_units || unitsToCharge),
                charged: true,
                refunded: false,
                charge_state: "CHARGED",
                next_refund_retry_at: null,
                last_refund_error_code: null
              }
            });
            await deps.jobs.appendJobEvent(job.id, job.owner_id, "BILLING_CHARGED", {
              worker_id: workerId || null,
              request_id: runRequestId,
              billing_request_id: chargeResult.billing_request_id,
              charged_units: Number(chargeResult.charged_units || unitsToCharge),
              duration_ms: Date.now() - chargeStartedAt,
              already_charged: Boolean(chargeResult.already_charged)
            });
          } catch (err) {
            const errorCode = deriveBillingErrorCode(err);
            return { ok: false, error: errorCode };
          }
        }

        if (modeBEngine === "external") {
          await deps.jobs.appendJobEvent(job.id, job.owner_id, "ENGINE_SELECTED", {
            worker_id: workerId || null,
            request_id: runRequestId,
            mode: executionMode,
            engine: "babeldoc"
          });
          await deps.jobs.appendJobEvent(job.id, job.owner_id, "ENGINE_RUN_STARTED", {
            worker_id: workerId || null,
            request_id: runRequestId,
            mode: executionMode,
            engine: "babeldoc"
          });
          const engineStartedAt = Date.now();
          firstProviderRequestAttempted = true;
          const engineResult = await engineAdapter.translatePdf({
            inputBuffer: inBytes,
            sourceLang: job.source_lang || null,
            targetLang: job.target_lang || null,
            options: {
              jobId: job.id,
              requestId: runRequestId
            }
          });

          if (!engineResult?.ok || !engineResult?.outputBuffer) {
            lastError = normalizeEngineErrorCode(engineResult?.error);
            await deps.jobs.appendJobEvent(job.id, job.owner_id, "ENGINE_RUN_FAILED", {
              worker_id: workerId || null,
              request_id: runRequestId,
              mode: executionMode,
              engine: "babeldoc",
              error_code: lastError,
              duration_ms: Date.now() - engineStartedAt
            });
          } else {
            const providerUsed = String(engineResult.engine_used || "babeldoc");
            bumpProviderUsage(providerUsed);
            const layoutMetrics = {
              reflow_strategy: "mode_b_engine_external",
              page_count: Number(engineResult.metrics?.page_count || 0),
              block_count: null,
              overflow_count: Number(engineResult.metrics?.overflow_pages || 0),
              overflow_flag: Boolean(engineResult.metrics?.overflow_flag),
              font_fallback: null
            };
            const outPath = await deps.storage.saveOutput(job.id, engineResult.outputBuffer);
            if (outputCache && !cacheBypass) {
              outputCache.set(cacheKey, {
                outputBuffer: engineResult.outputBuffer,
                layoutMetrics,
                meta: {
                  mode: executionMode,
                  provider_used: providerUsed,
                  selected_tier: null,
                  quality_gate_passed: null,
                  cost_delta_units: 0,
                  cache_key_version: cacheDescriptor.keyVersion
                }
              });
            }
            await deps.jobs.appendJobEvent(job.id, job.owner_id, "ENGINE_RUN_SUCCEEDED", {
              worker_id: workerId || null,
              request_id: runRequestId,
              mode: executionMode,
              engine: "babeldoc",
              page_count: layoutMetrics.page_count,
              overflow_flag: layoutMetrics.overflow_flag,
              duration_ms: Date.now() - engineStartedAt
            });
            await deps.jobs.appendJobEvent(job.id, job.owner_id, "MODE_B_OUTPUT_GENERATED", {
              worker_id: workerId || null,
              request_id: runRequestId,
              provider: providerUsed,
              chunk_count: null,
              page_count: layoutMetrics.page_count,
              block_count: null,
              overflow_flag: layoutMetrics.overflow_flag
            });
            await deps.jobs.update(job.id, {
              status: "READY",
              progress_pct: 100,
              output_file_path: outPath,
              provider_used: providerUsed,
              selected_tier: null,
              layout_metrics: layoutMetrics,
              translation_cache_hit: false,
              quality_gate_passed: null,
              quality_gate_reason: null,
              cost_delta_units: 0,
              ux_hint: null,
              billing: {
                ...job.billing,
                request_id: runRequestId,
                billing_request_id: chargeResult.billing_request_id,
                charged_units: Number(chargeResult.charged_units || unitsToCharge),
                charged: true,
                refunded: false,
                charge_state: "CHARGED",
                next_refund_retry_at: null,
                last_refund_error_code: null
              }
            });
            await deps.jobs.appendJobEvent(job.id, job.owner_id, "JOB_READY", {
              selected_tier: null
            });
            bump("jobs_ready_total");
            return { ok: true };
          }
        } else {
        const extractionStartedAt = Date.now();
        await deps.jobs.appendJobEvent(job.id, job.owner_id, "TEXT_EXTRACTION_STARTED", {
          worker_id: workerId || null,
          request_id: runRequestId
        });
        const blocks = extractPdfTextBlocks(inBytes);
        await deps.jobs.appendJobEvent(job.id, job.owner_id, "TEXT_EXTRACTION_DONE", {
          worker_id: workerId || null,
          request_id: runRequestId,
          block_count: blocks.length,
          duration_ms: Date.now() - extractionStartedAt
        });

        const chunks = chunkTextBlocks(blocks, { targetSize: 1800, maxSize: 2000 });
        await deps.jobs.appendJobEvent(job.id, job.owner_id, "TEXT_CHUNKING_DONE", {
          worker_id: workerId || null,
          request_id: runRequestId,
          chunk_count: chunks.length
        });

        await deps.jobs.appendJobEvent(job.id, job.owner_id, "LLM_TRANSLATION_STARTED", {
          worker_id: workerId || null,
          request_id: runRequestId,
          mode: executionMode,
          chunk_count: chunks.length
        });
        const llmStartedAt = Date.now();
        firstProviderRequestAttempted = true;
        const translated = await deps.providerAdapter.translateTextChunks({
          chunks,
          sourceLang: job.source_lang || null,
          targetLang: job.target_lang || null,
          executionMode: "MODE_B",
          simulateFailCode
        });

        if (!translated?.ok || !Array.isArray(translated.translatedChunks)) {
          lastError = translated?.error || "PROVIDER_UPSTREAM_5XX";
          await deps.jobs.appendJobEvent(job.id, job.owner_id, "LLM_TRANSLATION_FAILED", {
            worker_id: workerId || null,
            request_id: runRequestId,
            mode: executionMode,
            provider: translated?.provider_used || null,
            error_code: lastError,
            chunk_count: chunks.length,
            duration_ms: Date.now() - llmStartedAt
          });
        } else {
          const providerUsed = translated.provider_used || null;
          bumpProviderUsage(providerUsed);
          await deps.jobs.appendJobEvent(job.id, job.owner_id, "PROVIDER_SELECTED", {
            worker_id: workerId || null,
            request_id: runRequestId,
            mode: executionMode,
            provider: providerUsed
          });
          await deps.jobs.appendJobEvent(job.id, job.owner_id, "LLM_TRANSLATION_SUCCEEDED", {
            worker_id: workerId || null,
            request_id: runRequestId,
            mode: executionMode,
            provider: providerUsed,
            chunk_count: translated.translatedChunks.length,
            duration_ms: Date.now() - llmStartedAt
          });

          await deps.jobs.appendJobEvent(job.id, job.owner_id, "MODE_B_LAYOUT_STARTED", {
            worker_id: workerId || null,
            request_id: runRequestId,
            chunk_count: translated.translatedChunks.length
          });
          const layoutStartedAt = Date.now();
          const layoutModel = buildModeBLayoutModel({
            blocks,
            chunks,
            translatedChunks: translated.translatedChunks
          });
          const rendered = buildLayoutAwareTextPdf(layoutModel, {
            title: "LinguaVision Mode-B Output"
          });
          const outputBuffer = rendered.outputBuffer;
          const outPath = await deps.storage.saveOutput(job.id, outputBuffer);
          if (outputCache && !cacheBypass) {
            outputCache.set(cacheKey, {
              outputBuffer,
              layoutMetrics: {
                reflow_strategy: rendered.metrics.reflow_strategy,
                chunk_count: translated.translatedChunks.length,
                page_count: rendered.metrics.page_count,
                block_count: rendered.metrics.block_count,
                overflow_count: rendered.metrics.overflow_pages || 0,
                overflow_flag: Boolean(rendered.metrics.overflow_flag),
                font_fallback: rendered.metrics.font_fallback
              },
              meta: {
                mode: executionMode,
                provider_used: providerUsed,
                selected_tier: null,
                quality_gate_passed: null,
                cost_delta_units: 0,
                cache_key_version: cacheDescriptor.keyVersion
              }
            });
          }
          await deps.jobs.appendJobEvent(job.id, job.owner_id, "MODE_B_LAYOUT_DONE", {
            worker_id: workerId || null,
            request_id: runRequestId,
            page_count: rendered.metrics.page_count,
            block_count: rendered.metrics.block_count,
            overflow_flag: Boolean(rendered.metrics.overflow_flag),
            duration_ms: Date.now() - layoutStartedAt
          });
          await deps.jobs.appendJobEvent(job.id, job.owner_id, "MODE_B_OUTPUT_GENERATED", {
            worker_id: workerId || null,
            request_id: runRequestId,
            provider: providerUsed,
            chunk_count: translated.translatedChunks.length,
            page_count: rendered.metrics.page_count,
            block_count: rendered.metrics.block_count,
            overflow_flag: Boolean(rendered.metrics.overflow_flag)
          });

          await deps.jobs.update(job.id, {
            status: "READY",
            progress_pct: 100,
            output_file_path: outPath,
            provider_used: providerUsed,
            selected_tier: null,
            layout_metrics: {
              reflow_strategy: rendered.metrics.reflow_strategy,
              chunk_count: translated.translatedChunks.length,
              page_count: rendered.metrics.page_count,
              block_count: rendered.metrics.block_count,
              overflow_count: rendered.metrics.overflow_pages || 0,
              overflow_flag: Boolean(rendered.metrics.overflow_flag),
              font_fallback: rendered.metrics.font_fallback
            },
            translation_cache_hit: false,
            quality_gate_passed: null,
            quality_gate_reason: null,
            cost_delta_units: 0,
            ux_hint: null,
            billing: {
              ...job.billing,
              request_id: runRequestId,
              billing_request_id: chargeResult.billing_request_id,
              charged_units: Number(chargeResult.charged_units || unitsToCharge),
              charged: true,
              refunded: false,
              charge_state: "CHARGED",
              next_refund_retry_at: null,
              last_refund_error_code: null
            }
          });
          await deps.jobs.appendJobEvent(job.id, job.owner_id, "JOB_READY", {
            selected_tier: null
          });
          bump("jobs_ready_total");
          return { ok: true };
        }
        }
      }

      if (chargeResult && chargeResult.billing_request_id && firstProviderRequestAttempted) {
        const refundResult = await attemptRefund({
          jobId: job.id,
          workerId,
          runRequestId,
          billingRequestId: chargeResult.billing_request_id,
          chargedUnits: Number(chargeResult.charged_units || unitsToCharge),
          reasonCode: lastError
        });
        if (!refundResult.ok) {
          lastError = "BILLING_REFUND_ERROR";
        }
      }

      const finalJob = await deps.jobs.get(job.id);
      const finalBilling = finalJob?.billing || job.billing || {};
      await deps.jobs.update(job.id, {
        status: "FAILED",
        progress_pct: 100,
        error_code: lastError,
        quality_gate_passed: null,
        quality_gate_reason: null,
        ux_hint: mapErrorToUxHint(lastError),
        billing: {
          ...finalBilling,
          request_id: runRequestId,
          charge_state:
            finalBilling.charge_state ||
            (chargeResult && firstProviderRequestAttempted ? "CHARGED" : "NOT_CHARGED")
        }
      });
      await deps.jobs.appendJobEvent(job.id, job.owner_id, "JOB_FAILED", {
        error_code: lastError
      });
      bump("jobs_failed_total");
      return { ok: false, error: lastError };
    }

    const effectiveChain = route.mode === "strict" ? [route.chain[0]] : route.chain;
    for (let chainIndex = 0; chainIndex < effectiveChain.length; chainIndex++) {
      const tier = effectiveChain[chainIndex];
      const stepUnits = Math.ceil(baseStepUnits * getTierMultiplier(tier));
      const baseEconomyUnits = Math.ceil(baseStepUnits * getTierMultiplier("economy"));
      const runtimeGuard = validateRuntimeStep({
        packageName: route.packageName,
        spentUnits,
        stepUnits
      });

      if (!runtimeGuard.ok) {
        bump("runtime_guard_block_total");
        lastError = runtimeGuard.error;
        continue;
      }

      if (simulateFailBeforeProvider) {
        lastError = "PROVIDER_PRECHECK_FAILED";
        break;
      }

      if (!chargeResult) {
        const chargeStartedAt = Date.now();
        await deps.jobs.appendJobEvent(job.id, job.owner_id, "BILLING_CHARGE_STARTED", {
          worker_id: workerId || null,
          request_id: runRequestId
        });
        try {
          chargeResult = await deps.billingAdapter.charge({
            user_id: job.user_id || null,
            job_id: job.id,
            request_id: runRequestId,
            units: unitsToCharge,
            meta: {
              mode: route.mode,
              package_name: route.packageName,
              source_lang: job.source_lang || null,
              target_lang: job.target_lang || null
            }
          });
          await deps.jobs.update(job.id, {
            billing: {
              ...job.billing,
              request_id: runRequestId,
              billing_request_id: chargeResult.billing_request_id,
              charged_units: Number(chargeResult.charged_units || unitsToCharge),
              charged: true,
              refunded: false,
              charge_state: "CHARGED",
              next_refund_retry_at: null,
              last_refund_error_code: null
            }
          });
          await deps.jobs.appendJobEvent(job.id, job.owner_id, "BILLING_CHARGED", {
            worker_id: workerId || null,
            request_id: runRequestId,
            billing_request_id: chargeResult.billing_request_id,
            charged_units: Number(chargeResult.charged_units || unitsToCharge),
            duration_ms: Date.now() - chargeStartedAt,
            already_charged: Boolean(chargeResult.already_charged)
          });
        } catch (err) {
          const errorCode = deriveBillingErrorCode(err);
          return { ok: false, error: errorCode };
        }
      }

      let translated = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        if (attempt > 1) bump("provider_retry_total");
        await deps.jobs.appendJobEvent(job.id, job.owner_id, "PROVIDER_REQUEST_STARTED", {
          worker_id: workerId || null,
          request_id: runRequestId,
          mode: executionMode,
          tier,
          attempt_no: attempt
        });
        firstProviderRequestAttempted = true;
        const providerCallStartedAt = Date.now();
        translated = await deps.providerAdapter.translateDocument({
          inputBuffer: inBytes,
          executionMode,
          tier,
          mode: route.mode,
          simulateFailTier,
          simulateFailTiers,
          simulateFailCode,
          simulateRetryOnceTiers,
          simulateLayoutMissingAnchorCount,
          simulateLayoutOverflowCount,
          simulateProviderLatencyMs,
          providerTimeoutMs,
          jobId: job.id,
          sourceLang: job.source_lang || null,
          targetLang: job.target_lang || null
        });
        const providerUsed = translated?.provider_used || translated?.provider || null;
        if (attempt === 1) {
          await deps.jobs.appendJobEvent(job.id, job.owner_id, "PROVIDER_SELECTED", {
            worker_id: workerId || null,
            request_id: runRequestId,
            mode: executionMode,
            tier,
            provider: providerUsed
          });
        }
        if (translated?.ok) {
          await deps.jobs.appendJobEvent(job.id, job.owner_id, "PROVIDER_REQUEST_SUCCEEDED", {
            worker_id: workerId || null,
            request_id: runRequestId,
            mode: executionMode,
            tier,
            provider: providerUsed,
            attempt_no: attempt,
            duration_ms: Date.now() - providerCallStartedAt
          });
        } else {
          await deps.jobs.appendJobEvent(job.id, job.owner_id, "PROVIDER_REQUEST_FAILED", {
            worker_id: workerId || null,
            request_id: runRequestId,
            mode: executionMode,
            tier,
            provider: providerUsed,
            attempt_no: attempt,
            error_code: translated?.error || null,
            duration_ms: Date.now() - providerCallStartedAt
          });
        }

        if (translated.ok) break;
        lastError = translated.error || "PROVIDER_UPSTREAM_5XX";
      }

      if (!translated || !translated.ok) {
        if (chainIndex < effectiveChain.length - 1) bump("provider_fallback_total");
        continue;
      }

      const qualityGateFailed =
        route.mode === "strict" &&
        !featureFlags.disableStrictQualityGate &&
        ((translated.layoutMetrics?.missing_anchor_count || 0) > 0 ||
          (translated.layoutMetrics?.overflow_count || 0) > 0);
      if (qualityGateFailed) {
        lastError = "LAYOUT_QUALITY_GATE_BLOCK";
        continue;
      }

      const outPath = await deps.storage.saveOutput(job.id, translated.outputBuffer);
      bumpProviderUsage(translated.provider_used || translated.provider || null);
      if (outputCache && !cacheBypass) {
        outputCache.set(cacheKey, {
          outputBuffer: translated.outputBuffer,
          layoutMetrics: translated.layoutMetrics || null,
          meta: {
            mode: executionMode,
            provider_used: translated.provider_used || translated.provider || null,
            selected_tier: tier,
            quality_gate_passed: route.mode === "strict" ? true : null,
            cost_delta_units: Math.max(0, stepUnits - baseEconomyUnits),
            cache_key_version: cacheDescriptor.keyVersion
          }
        });
      }
      await deps.jobs.update(job.id, {
        status: "READY",
        progress_pct: 100,
        output_file_path: outPath,
        provider_used: translated.provider_used || translated.provider || null,
        selected_tier: tier,
        layout_metrics: translated.layoutMetrics || null,
        translation_cache_hit: Boolean(translated.cacheHit),
        quality_gate_passed: route.mode === "strict" ? true : null,
        quality_gate_reason: null,
        cost_delta_units: Math.max(0, stepUnits - baseEconomyUnits),
        ux_hint: null,
        billing: {
          ...job.billing,
          request_id: runRequestId,
          billing_request_id: chargeResult.billing_request_id,
          charged_units: Number(chargeResult.charged_units || unitsToCharge),
          charged: true,
          refunded: false,
          charge_state: "CHARGED",
          next_refund_retry_at: null,
          last_refund_error_code: null
        }
      });
      await deps.jobs.appendJobEvent(job.id, job.owner_id, "JOB_READY", {
        selected_tier: tier
      });
      bump("jobs_ready_total");
      return { ok: true };
    }

    if (chargeResult && chargeResult.billing_request_id && firstProviderRequestAttempted) {
      const refundResult = await attemptRefund({
        jobId: job.id,
        workerId,
        runRequestId,
        billingRequestId: chargeResult.billing_request_id,
        chargedUnits: Number(chargeResult.charged_units || unitsToCharge),
        reasonCode: lastError
      });
      if (!refundResult.ok) {
        lastError = "BILLING_REFUND_ERROR";
      }
    }

    const finalJob = await deps.jobs.get(job.id);
    const finalBilling = finalJob?.billing || job.billing || {};
    await deps.jobs.update(job.id, {
      status: "FAILED",
      progress_pct: 100,
      error_code: lastError,
      quality_gate_passed: lastError === "LAYOUT_QUALITY_GATE_BLOCK" ? false : null,
      quality_gate_reason: lastError === "LAYOUT_QUALITY_GATE_BLOCK" ? "strict_layout_guard" : null,
      ux_hint: mapErrorToUxHint(lastError),
      billing: {
        ...finalBilling,
        request_id: runRequestId,
        charge_state:
          finalBilling.charge_state ||
          (chargeResult && firstProviderRequestAttempted ? "CHARGED" : "NOT_CHARGED")
      }
    });
    await deps.jobs.appendJobEvent(job.id, job.owner_id, "JOB_FAILED", {
      error_code: lastError
    });
    bump("jobs_failed_total");
    return { ok: false, error: lastError };
  };
}

export function createRefundReconciler(deps) {
  return async function reconcile({ jobId, workerId }) {
    const job = await deps.jobs.get(jobId);
    if (!job) return { ok: false, error: "job_not_found" };
    const billing = job.billing || {};
    if (!billing.charged || billing.refunded) return { ok: true, skipped: true };
    if (!["REFUND_PENDING", "REFUND_RETRYING"].includes(billing.charge_state || "")) {
      return { ok: true, skipped: true };
    }
    const runRequestId = billing.request_id;
    const billingRequestId = billing.billing_request_id;
    const chargedUnits = Number(billing.charged_units || 0);
    const attemptNo = Number(billing.refund_retry_count || 0) + 1;
    const startedAt = Date.now();

    await deps.jobs.appendJobEvent(job.id, job.owner_id, "BILLING_REFUND_STARTED", {
      worker_id: workerId || null,
      request_id: runRequestId,
      billing_request_id: billingRequestId,
      refund_retry_count: attemptNo,
      reason: job.error_code || billing.last_refund_error_code || "REFUND_RETRY"
    });

    try {
      const refundResult = await deps.billingAdapter.refund({
        user_id: job.user_id || null,
        job_id: job.id,
        request_id: runRequestId,
        billing_request_id: billingRequestId,
        units: chargedUnits,
        reason: job.error_code || billing.last_refund_error_code || "REFUND_RETRY",
        meta: {
          mode: job.mode || null,
          package_name: job.package_name || null
        }
      });
      await deps.jobs.update(job.id, {
        billing: {
          ...billing,
          refunded: true,
          charge_state: "REFUNDED",
          next_refund_retry_at: null,
          last_refund_error_code: null,
          refund_last_attempt_at: nowIso()
        }
      });
      await deps.jobs.appendJobEvent(job.id, job.owner_id, "BILLING_REFUNDED", {
        worker_id: workerId || null,
        request_id: runRequestId,
        billing_request_id: billingRequestId,
        refund_retry_count: attemptNo,
        duration_ms: Date.now() - startedAt,
        already_refunded: Boolean(refundResult.already_refunded)
      });
      return { ok: true };
    } catch (err) {
      const errorCode = deriveBillingErrorCode(err);
      const nextRetryCount = attemptNo;
      const nextRetryAt = getNextRefundRetryAt(nextRetryCount);
      const nextState = nextRetryAt ? "REFUND_PENDING" : "REFUND_FAILED_FINAL";
      await deps.jobs.update(job.id, {
        billing: {
          ...billing,
          charge_state: nextState,
          refund_retry_count: nextRetryCount,
          next_refund_retry_at: nextRetryAt,
          last_refund_error_code: errorCode,
          refund_last_attempt_at: nowIso()
        }
      });
      await deps.jobs.appendJobEvent(job.id, job.owner_id, "BILLING_REFUND_FAILED", {
        worker_id: workerId || null,
        request_id: runRequestId,
        billing_request_id: billingRequestId,
        error_code: errorCode,
        refund_retry_count: nextRetryCount
      });
      if (nextRetryAt) {
        await deps.jobs.appendJobEvent(job.id, job.owner_id, "BILLING_REFUND_RETRY_SCHEDULED", {
          worker_id: workerId || null,
          request_id: runRequestId,
          billing_request_id: billingRequestId,
          refund_retry_count: nextRetryCount,
          next_refund_retry_at: nextRetryAt
        });
      }
      return { ok: false, error: errorCode };
    }
  };
}
