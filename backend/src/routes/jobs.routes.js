import express from "express";
import multer from "multer";
import crypto from "crypto";
import { estimateStepUnits, validateAdmission, validateRuntimeStep } from "../routing/cost.guard.js";
import { getTierMultiplier, planRoute } from "../providers/provider.router.js";
import { BillingError, toSafeBillingErrorCode } from "../billing/billing.adapter.js";

const MAX_UPLOAD_BYTES = Number(process.env.LV_MAX_UPLOAD_BYTES || 15 * 1024 * 1024);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    fields: 32,
    fieldSize: 64 * 1024
  }
});
const ALLOWED_PACKAGES = new Set(["free", "pro", "premium"]);
const ALLOWED_MODES = new Set(["readable", "strict"]);
const ALLOWED_TIERS = new Set(["economy", "standard", "premium"]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deriveOwnerId(apiKey) {
  return crypto.createHash("sha256").update(apiKey).digest("hex").slice(0, 8);
}

function createRateLimiter({ windowMs, max, name }) {
  const buckets = new Map();

  return function rateLimiter(req, res, next) {
    const now = Date.now();
    const key = `${req.ip || "unknown"}:${name}`;
    const current = buckets.get(key);
    if (!current || now >= current.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (current.count >= max) {
      return res.status(429).json({ error: "rate_limited" });
    }
    current.count += 1;
    return next();
  };
}

function isMulterLimitError(err) {
  return (
    err &&
    (err.code === "LIMIT_FILE_SIZE" ||
      err.code === "LIMIT_FIELD_VALUE" ||
      err.code === "LIMIT_FIELD_KEY" ||
      err.code === "LIMIT_FIELD_COUNT" ||
      err.code === "LIMIT_PART_COUNT")
  );
}


function normalizeCsvParam(value) {
  return (value || "")
    .toString()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function hasUnknownTier(tiers) {
  return tiers.some((tier) => !ALLOWED_TIERS.has(tier));
}

function isValidLangCode(value) {
  // Accept ISO-like language codes: tr, en, en-US, pt-BR.
  return /^[a-z]{2,3}(-[A-Z]{2})?$/.test((value || "").toString().trim());
}

function mapErrorToUxHint(errorCode) {
  if (errorCode === "INPUT_LIMIT_EXCEEDED") return "plan_limit_upgrade";
  if (errorCode === "COST_GUARD_BLOCK") return "cost_limit_reduce_scope";
  if (errorCode === "COST_LIMIT_STOP") return "cost_limit_partial_result";
  if (errorCode && errorCode.startsWith("BILLING_")) return "retry_later";
  if (errorCode === "LAYOUT_QUALITY_GATE_BLOCK") return "switch_mode_or_fix_pdf";
  if (errorCode && errorCode.startsWith("PROVIDER_")) return "retry_or_fallback";
  return "review_job_error";
}

export function createJobsRouter(deps) {
  const router = express.Router();
  const configuredApiKeys = (deps.apiKey || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const createLimiter = createRateLimiter({
    windowMs: 60_000,
    max: Number(process.env.LV_RATE_LIMIT_CREATE_PER_MIN || 10),
    name: "jobs_create"
  });
  const runLimiter = createRateLimiter({
    windowMs: 60_000,
    max: Number(process.env.LV_RATE_LIMIT_RUN_PER_MIN || 30),
    name: "jobs_run"
  });
  const getLimiter = createRateLimiter({
    windowMs: 60_000,
    max: Number(process.env.LV_RATE_LIMIT_GET_PER_MIN || 120),
    name: "jobs_get"
  });
  const featureFlags = deps.featureFlags || {
    disableLayoutPipeline: false,
    disableTranslationCache: false,
    disableStrictQualityGate: false
  };
  const stats = deps.stats || {
    jobs_create_total: 0,
    jobs_run_total: 0,
    jobs_get_total: 0,
    jobs_events_total: 0,
    jobs_output_total: 0,
    jobs_ready_total: 0,
    jobs_failed_total: 0,
    provider_retry_total: 0,
    provider_fallback_total: 0,
    runtime_guard_block_total: 0
  };
  deps.stats = stats;

  function bump(key) {
    stats[key] = (stats[key] || 0) + 1;
  }

  function requireApiKey(req, res, next) {
    const provided = (req.get("x-api-key") || "").toString();
    if (!configuredApiKeys.length || !provided || !configuredApiKeys.includes(provided)) {
      return res.status(401).json({ error: "unauthorized" });
    }
    req.auth = { owner_id: deriveOwnerId(provided) };
    return next();
  }

  function ensureOwnedJob(req, res) {
    const job = deps.jobs.get(req.params.id);
    if (!job) {
      res.status(404).json({ error: "job_not_found" });
      return null;
    }
    if (!job.owner_id || job.owner_id !== req.auth?.owner_id) {
      res.status(404).json({ error: "job_not_found" });
      return null;
    }
    res.locals.job_id = job.id;
    res.locals.billing_request_id = job.billing?.billing_request_id || null;
    return job;
  }

  function parseUpload(req, res, next) {
    upload.single("file")(req, res, (err) => {
      if (!err) return next();
      if (isMulterLimitError(err)) {
        return res.status(413).json({ error: "payload_too_large" });
      }
      return res.status(400).json({ error: "invalid_input" });
    });
  }

  async function processJob({
    jobId,
    requestId,
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
    const job = deps.jobs.get(jobId);
    if (!job) return { ok: false, error: "job_not_found" };
    const runRequestId = requestId || job.billing?.request_id || crypto.randomUUID();

    if (workerDelayMs > 0) {
      await sleep(workerDelayMs);
    }

    const inBytes = await deps.storage.readFile(job.input_file_path);
    const route = planRoute({ packageName: job.package_name || "free", mode: job.mode || "readable" });
    const baseStepUnits = estimateStepUnits({ fileSizeBytes: inBytes.length, mode: route.mode });
    const spentUnits = Number(job.billing?.charged_units || 0);
    const unitsToCharge = Math.max(1, baseStepUnits);
    let lastError = "ROUTER_NO_FALLBACK_PATH";
    let chargeResult = null;

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
      deps.jobs.update(job.id, {
        billing: {
          ...job.billing,
          request_id: runRequestId,
          billing_request_id: chargeResult.billing_request_id,
          charged_units: Number(chargeResult.charged_units || unitsToCharge),
          charged: true,
          refunded: false
        }
      });
    } catch (err) {
      if (err instanceof BillingError) {
        return { ok: false, error: err.code };
      }
      return { ok: false, error: toSafeBillingErrorCode(err) };
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

      let translated = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        if (attempt > 1) bump("provider_retry_total");
        translated = await deps.providerAdapter.translateDocument({
          inputBuffer: inBytes,
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

        if (translated.ok) break;
        lastError = translated.error || "PROVIDER_UPSTREAM_5XX";
      }

      if (!translated || !translated.ok) {
        if (chainIndex < effectiveChain.length - 1) {
          bump("provider_fallback_total");
        }
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
      deps.jobs.update(job.id, {
        status: "READY",
        progress_pct: 100,
        output_file_path: outPath,
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
          refunded: false
        }
      });
      bump("jobs_ready_total");

      return { ok: true };
    }

    if (chargeResult && chargeResult.billing_request_id) {
      try {
        const refundResult = await deps.billingAdapter.refund({
          user_id: job.user_id || null,
          job_id: job.id,
          request_id: runRequestId,
          billing_request_id: chargeResult.billing_request_id,
          units: Number(chargeResult.charged_units || unitsToCharge),
          reason: lastError,
          meta: {
            mode: route.mode,
            package_name: route.packageName
          }
        });
        deps.jobs.update(job.id, {
          billing: {
            ...job.billing,
            request_id: runRequestId,
            billing_request_id: chargeResult.billing_request_id,
            charged_units: Number(chargeResult.charged_units || unitsToCharge),
            charged: true,
            refunded: Boolean(refundResult.refunded)
          }
        });
      } catch {
        lastError = "BILLING_REFUND_ERROR";
      }
    }

    deps.jobs.update(job.id, {
      status: "FAILED",
      progress_pct: 100,
      error_code: lastError,
      quality_gate_passed: lastError === "LAYOUT_QUALITY_GATE_BLOCK" ? false : null,
      quality_gate_reason: lastError === "LAYOUT_QUALITY_GATE_BLOCK" ? "strict_layout_guard" : null,
      ux_hint: mapErrorToUxHint(lastError)
    });
    bump("jobs_failed_total");

    return { ok: false, error: lastError };
  }

  // Expose process fn to server queue adapter
  deps.processJob = processJob;

  router.post("/", requireApiKey, createLimiter, parseUpload, async (req, res) => {
    bump("jobs_create_total");
    const file = req.file;
    const targetLang = (req.body?.target_lang || "").toString().trim();
    const packageName = (req.body?.package || "free").toString().trim().toLowerCase();
    const mode = (req.body?.mode || "readable").toString().trim().toLowerCase();
    const sourceLang = req.body?.source_lang ? req.body.source_lang.toString().trim() : null;
    const remainingUnitsRaw = req.body?.remaining_units;
    const remainingUnits = remainingUnitsRaw !== undefined ? Number(remainingUnitsRaw) : null;
    if (!file) return res.status(400).json({ error: "invalid_input" });
    if (!targetLang) return res.status(400).json({ error: "invalid_input" });
    if (!isValidLangCode(targetLang)) return res.status(400).json({ error: "invalid_input" });
    if (sourceLang && !isValidLangCode(sourceLang)) return res.status(400).json({ error: "invalid_input" });
    if (!ALLOWED_PACKAGES.has(packageName)) return res.status(400).json({ error: "invalid_input" });
    if (!ALLOWED_MODES.has(mode)) return res.status(400).json({ error: "invalid_input" });
    if (packageName === "free" && mode === "strict") {
      return res.status(409).json({ error: "INPUT_LIMIT_EXCEEDED" });
    }
    if (remainingUnits !== null && (!Number.isFinite(remainingUnits) || remainingUnits < 0)) {
      return res.status(400).json({ error: "invalid_input" });
    }

    const fileSizeBytes = file.size || file.buffer.length;
    const stepUnits = estimateStepUnits({ fileSizeBytes, mode });
    const worstCaseUnits = stepUnits * 2;
    const admission = validateAdmission({ packageName, fileSizeBytes, worstCaseUnits, remainingUnits });
    if (!admission.ok) {
      const code = admission.error;
      const status = code === "INPUT_LIMIT_EXCEEDED" || code === "COST_GUARD_BLOCK" ? 409 : 400;
      return res.status(status).json({ error: code });
    }

    const temp = deps.jobs.create({
      owner_id: req.auth.owner_id,
      target_lang: targetLang,
      source_lang: sourceLang,
      input_file_path: ""
    });
    res.locals.job_id = temp.id;

    const inputPath = await deps.storage.saveInput(temp.id, file.originalname || "input.pdf", file.buffer);
    deps.jobs.update(temp.id, {
      input_file_path: inputPath,
      package_name: packageName,
      mode,
      budget_units: admission.budgetUnits
    });

    return res.status(201).json({ job_id: temp.id, status: "PENDING" });
  });

  router.post("/:id/run", requireApiKey, runLimiter, async (req, res) => {
    bump("jobs_run_total");
    const job = ensureOwnedJob(req, res);
    if (!job) return;
    res.locals.job_id = job.id;
    res.locals.billing_request_id = job.billing?.billing_request_id || null;
    if (job.status === "PROCESSING" || job.status === "READY") {
      return res.status(202).json({
        accepted: true,
        job_id: job.id,
        status: job.status,
        idempotent: true
      });
    }
    if (job.status !== "PENDING") return res.status(409).json({ error: "job_already_running" });

    const simulateFailTier = (req.query?.simulate_fail_tier || "").toString().trim() || null;
    const simulateFailTiers = normalizeCsvParam(req.query?.simulate_fail_tiers);
    const simulateFailCode = (req.query?.simulate_fail_code || "").toString().trim() || "PROVIDER_TIMEOUT";
    const simulateRetryOnceTiers = normalizeCsvParam(req.query?.simulate_retry_once_tiers);
    const simulateLayoutMissingAnchorCount = Math.max(
      0,
      Number(req.query?.simulate_layout_missing_anchor_count || 0)
    );
    const simulateLayoutOverflowCount = Math.max(0, Number(req.query?.simulate_layout_overflow_count || 0));
    const simulateProviderLatencyMs = Math.max(0, Number(req.query?.simulate_provider_latency_ms || 0));
    const providerTimeoutMs = Math.max(1, Number(req.query?.provider_timeout_ms || 2500));
    const workerDelayRaw = Number(req.query?.worker_delay_ms || 0);
    if (!Number.isFinite(workerDelayRaw)) return res.status(400).json({ error: "invalid_input" });
    if (
      !Number.isFinite(simulateLayoutMissingAnchorCount) ||
      !Number.isFinite(simulateLayoutOverflowCount) ||
      !Number.isFinite(simulateProviderLatencyMs) ||
      !Number.isFinite(providerTimeoutMs)
    ) {
      return res.status(400).json({ error: "invalid_input" });
    }
    const workerDelayMs = Math.max(0, workerDelayRaw);
    const asyncRaw = req.query?.async;
    if (asyncRaw !== undefined && asyncRaw !== "0" && asyncRaw !== "1") {
      return res.status(400).json({ error: "invalid_input" });
    }
    const asyncMode = asyncRaw === "1";
    if (simulateFailTier && !ALLOWED_TIERS.has(simulateFailTier)) {
      return res.status(400).json({ error: "invalid_input" });
    }
    if (hasUnknownTier(simulateFailTiers) || hasUnknownTier(simulateRetryOnceTiers)) {
      return res.status(400).json({ error: "invalid_input" });
    }

    const runRequestId = job.billing?.request_id || crypto.randomUUID();
    deps.jobs.update(job.id, {
      status: "PROCESSING",
      progress_pct: 30,
      billing: { ...job.billing, request_id: runRequestId }
    });

    if (asyncMode) {
      if (deps.queue && typeof deps.queue.enqueue === "function") {
        deps.queue.enqueue({
          jobId: job.id,
          requestId: runRequestId,
          simulateFailTier,
          simulateFailTiers,
          simulateFailCode,
          simulateRetryOnceTiers,
          simulateLayoutMissingAnchorCount,
          simulateLayoutOverflowCount,
          simulateProviderLatencyMs,
          providerTimeoutMs,
          workerDelayMs
        });
      } else {
        void processJob({
          jobId: job.id,
          requestId: runRequestId,
          simulateFailTier,
          simulateFailTiers,
          simulateFailCode,
          simulateRetryOnceTiers,
          simulateLayoutMissingAnchorCount,
          simulateLayoutOverflowCount,
          simulateProviderLatencyMs,
          providerTimeoutMs,
          workerDelayMs
        });
      }
      return res.status(202).json({ accepted: true, job_id: job.id, status: "PROCESSING" });
    }

    const result = await processJob({
      jobId: job.id,
      requestId: runRequestId,
      simulateFailTier,
      simulateFailTiers,
      simulateFailCode,
      simulateRetryOnceTiers,
      simulateLayoutMissingAnchorCount,
      simulateLayoutOverflowCount,
      simulateProviderLatencyMs,
      providerTimeoutMs,
      workerDelayMs
    });
    if (!result.ok) {
      return res.status(409).json({ error: result.error });
    }
    const latest = deps.jobs.get(job.id);
    res.locals.billing_request_id = latest?.billing?.billing_request_id || null;

    return res.status(202).json({ accepted: true, job_id: job.id, status: "PROCESSING" });
  });

  router.get("/metrics", requireApiKey, (req, res) => {
    const queue = deps.queue || null;
    const queueDepth = queue && Array.isArray(queue.q) ? queue.q.length : 0;
    const queueBusy = Boolean(queue && queue.busy);
    const cacheMetrics =
      deps.providerAdapter && typeof deps.providerAdapter.getCacheMetrics === "function"
        ? deps.providerAdapter.getCacheMetrics()
        : {};
    return res.status(200).json({
      ...stats,
      ...cacheMetrics,
      feature_disable_layout_pipeline: Boolean(featureFlags.disableLayoutPipeline),
      feature_disable_translation_cache: Boolean(featureFlags.disableTranslationCache),
      feature_disable_strict_quality_gate: Boolean(featureFlags.disableStrictQualityGate),
      queue_depth: queueDepth,
      queue_busy: queueBusy
    });
  });

  router.get("/:id", requireApiKey, getLimiter, (req, res) => {
    bump("jobs_get_total");
    const job = ensureOwnedJob(req, res);
    if (!job) return;
    return res.status(200).json({
      job_id: job.id,
      status: job.status,
      progress_pct: job.progress_pct,
      error_code: job.error_code,
      selected_tier: job.selected_tier,
      layout_metrics: job.layout_metrics,
      translation_cache_hit: Boolean(job.translation_cache_hit),
      quality_gate_passed: job.quality_gate_passed,
      quality_gate_reason: job.quality_gate_reason,
      cost_delta_units: job.cost_delta_units,
      ux_hint: job.ux_hint,
      last_transition_at: job.last_transition_at,
      billing: job.billing
    });
  });

  router.get("/:id/events", requireApiKey, getLimiter, (req, res) => {
    bump("jobs_events_total");
    const job = ensureOwnedJob(req, res);
    if (!job) return;
    return res.status(200).json({ job_id: req.params.id, events: job.events || [] });
  });

  router.get("/:id/output", requireApiKey, getLimiter, async (req, res) => {
    bump("jobs_output_total");
    const job = ensureOwnedJob(req, res);
    if (!job) return;
    if (job.status !== "READY") return res.status(409).json({ error: "job_not_ready" });

    const bytes = await deps.storage.readFile(job.output_file_path);
    res.setHeader("content-type", "application/pdf");
    return res.status(200).send(bytes);
  });

  return router;
}
