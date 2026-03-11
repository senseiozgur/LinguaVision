import express from "express";
import multer from "multer";
import crypto from "crypto";
import { estimateStepUnits, validateAdmission } from "../routing/cost.guard.js";

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
const ALLOWED_PROVIDER_MODES = new Set(["mode_a", "mode_b"]);
const RUN_ERROR_CODES = ["LAYOUT_QUALITY_GATE_BLOCK"];

function deriveOwnerId(apiKey) {
  return crypto.createHash("sha256").update(apiKey).digest("hex").slice(0, 8);
}

function createRateLimiter({ windowMs, max, name }) {
  const buckets = new Map();

  return async function rateLimiter(req, res, next) {
    const now = Date.now();
    const keySubject = req.auth?.owner_id || req.ip || "unknown";

    if (req.rateLimitStore && typeof req.rateLimitStore.consume === "function") {
      try {
        const result = await req.rateLimitStore.consume({
          scope: name,
          subject: String(keySubject),
          windowSec: Math.max(1, Math.ceil(windowMs / 1000)),
          maxHits: max
        });
        if (!result.allowed) {
          return res.status(429).json({ error: "rate_limited" });
        }
        return next();
      } catch {
        // fallback below if shared limiter fails unexpectedly
      }
    }

    const key = `${keySubject}:${name}`;
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

export function createJobsRouter(deps) {
  const router = express.Router();
  router.use((req, _res, next) => {
    req.rateLimitStore = deps.rateLimitStore || null;
    next();
  });
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
  const metricsEnabled = deps.metricsEnabled !== false;
  const metricsAllowPrimaryKey = deps.metricsAllowPrimaryKey !== false;
  const metricsApiKeys = (deps.metricsApiKey || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

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

  function requireMetricsAccess(req, res, next) {
    if (!metricsEnabled) {
      return res.status(404).json({ error: "not_found" });
    }
    const metricsProvided = (req.get("x-metrics-key") || "").toString();
    if (metricsApiKeys.length > 0) {
      if (!metricsProvided || !metricsApiKeys.includes(metricsProvided)) {
        return res.status(401).json({ error: "unauthorized" });
      }
      req.auth = { owner_id: "metrics" };
      return next();
    }
    if (metricsAllowPrimaryKey) {
      return requireApiKey(req, res, next);
    }
    return res.status(401).json({ error: "unauthorized" });
  }

  async function ensureOwnedJob(req, res) {
    const job = await deps.jobs.get(req.params.id);
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

  router.post("/", requireApiKey, createLimiter, parseUpload, async (req, res) => {
    bump("jobs_create_total");
    const file = req.file;
    const targetLang = (req.body?.target_lang || "").toString().trim();
    const packageName = (req.body?.package || "free").toString().trim().toLowerCase();
    const mode = (req.body?.mode || "readable").toString().trim().toLowerCase();
    const sourceLang = req.body?.source_lang ? req.body.source_lang.toString().trim() : null;
    const providerModeRaw = (req.body?.provider_mode || "mode_a").toString().trim().toLowerCase();
    const providerMode = providerModeRaw === "mode_b" ? "MODE_B" : "MODE_A";
    if (!file) return res.status(400).json({ error: "invalid_input" });
    if (!targetLang) return res.status(400).json({ error: "invalid_input" });
    if (!isValidLangCode(targetLang)) return res.status(400).json({ error: "invalid_input" });
    if (sourceLang && !isValidLangCode(sourceLang)) return res.status(400).json({ error: "invalid_input" });
    if (!ALLOWED_PACKAGES.has(packageName)) return res.status(400).json({ error: "invalid_input" });
    if (!ALLOWED_MODES.has(mode)) return res.status(400).json({ error: "invalid_input" });
    if (!ALLOWED_PROVIDER_MODES.has(providerModeRaw)) return res.status(400).json({ error: "invalid_input" });
    if (packageName === "free" && mode === "strict") {
      return res.status(409).json({ error: "INPUT_LIMIT_EXCEEDED" });
    }
    const fileSizeBytes = file.size || file.buffer.length;
    const stepUnits = estimateStepUnits({ fileSizeBytes, mode });
    const worstCaseUnits = stepUnits * 2;
    const admission = validateAdmission({ packageName, fileSizeBytes, worstCaseUnits });
    if (!admission.ok) {
      const code = admission.error;
      const status = code === "INPUT_LIMIT_EXCEEDED" || code === "COST_GUARD_BLOCK" ? 409 : 400;
      return res.status(status).json({ error: code });
    }

    const temp = await deps.jobs.create({
      owner_id: req.auth.owner_id,
      target_lang: targetLang,
      source_lang: sourceLang,
      provider_mode: providerMode,
      input_file_path: ""
    });
    res.locals.job_id = temp.id;

    const inputPath = await deps.storage.saveInput(temp.id, file.originalname || "input.pdf", file.buffer);
    await deps.jobs.update(temp.id, {
      input_file_path: inputPath,
      package_name: packageName,
      mode,
      provider_mode: providerMode,
      budget_units: admission.budgetUnits
    });
    await deps.jobs.appendJobEvent(temp.id, req.auth.owner_id, "JOB_CREATED", {
      file_size_bytes: fileSizeBytes,
      target_lang: targetLang
    });

    return res.status(201).json({ job_id: temp.id, status: "PENDING" });
  });

  router.post("/:id/run", requireApiKey, runLimiter, async (req, res) => {
    bump("jobs_run_total");
    const job = await ensureOwnedJob(req, res);
    if (!job) return;
    res.locals.job_id = job.id;
    res.locals.billing_request_id = job.billing?.billing_request_id || null;
    if (job.status === "PROCESSING" || job.status === "READY" || job.status === "QUEUED") {
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
    const simulateFailCodeRaw = (req.query?.simulate_fail_code || "").toString().trim();
    const simulateFailCode = simulateFailCodeRaw ? simulateFailCodeRaw : null;
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
    const simulateFailBeforeProviderRaw = req.query?.simulate_fail_before_provider;
    if (asyncRaw !== undefined && asyncRaw !== "0" && asyncRaw !== "1") {
      return res.status(400).json({ error: "invalid_input" });
    }
    if (
      simulateFailBeforeProviderRaw !== undefined &&
      simulateFailBeforeProviderRaw !== "0" &&
      simulateFailBeforeProviderRaw !== "1"
    ) {
      return res.status(400).json({ error: "invalid_input" });
    }
    const asyncMode = asyncRaw === "1";
    const simulateFailBeforeProvider = simulateFailBeforeProviderRaw === "1";
    if (simulateFailTier && !ALLOWED_TIERS.has(simulateFailTier)) {
      return res.status(400).json({ error: "invalid_input" });
    }
    if (hasUnknownTier(simulateFailTiers) || hasUnknownTier(simulateRetryOnceTiers)) {
      return res.status(400).json({ error: "invalid_input" });
    }

    const runRequestId = job.billing?.request_id || crypto.randomUUID();
    await deps.jobs.update(job.id, {
      status: "QUEUED",
      progress_pct: 10,
      billing: { ...job.billing, request_id: runRequestId }
    });
    await deps.jobs.appendJobEvent(job.id, req.auth.owner_id, "JOB_RUN_REQUESTED", {
      request_id: runRequestId
    });
    await deps.jobs.appendJobEvent(job.id, req.auth.owner_id, "JOB_QUEUED", {
      request_id: runRequestId
    });

    if (deps.queue && typeof deps.queue.enqueue === "function") {
        deps.queue.enqueue({
          jobId: job.id,
          requestId: runRequestId,
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
      });
    }

    return res.status(202).json({ accepted: true, job_id: job.id, status: "QUEUED" });
  });

  router.get("/metrics", requireMetricsAccess, (req, res) => {
    const queue = deps.queue || null;
    const queueDepth = queue && Array.isArray(queue.q) ? queue.q.length : 0;
    const queueBusy = Boolean(queue && queue.busy);
    const cacheMetrics =
      deps.providerAdapter && typeof deps.providerAdapter.getCacheMetrics === "function"
        ? deps.providerAdapter.getCacheMetrics()
        : {};
    const outputCacheMetrics =
      deps.outputCache && typeof deps.outputCache.metrics === "function" ? deps.outputCache.metrics() : {};
    const rateLimitMetrics =
      deps.rateLimitStore && typeof deps.rateLimitStore.metrics === "function" ? deps.rateLimitStore.metrics() : {};
    return res.status(200).json({
      ...stats,
      ...cacheMetrics,
      output_cache_entries: Number(outputCacheMetrics.cache_entries || 0),
      output_cache_hits_total: Number(outputCacheMetrics.cache_hits_total || 0),
      output_cache_misses_total: Number(outputCacheMetrics.cache_misses_total || 0),
      output_cache_evictions_total: Number(outputCacheMetrics.cache_evictions_total || 0),
      output_cache_persist_enabled: Boolean(outputCacheMetrics.cache_persist_enabled),
      rate_limit_mode: rateLimitMetrics.rate_limit_mode || "memory",
      rate_limit_shared_errors_total: Number(rateLimitMetrics.rate_limit_shared_errors_total || 0),
      rate_limit_shared_hits_total: Number(rateLimitMetrics.rate_limit_shared_hits_total || 0),
      rate_limit_memory_hits_total: Number(rateLimitMetrics.rate_limit_memory_hits_total || 0),
      feature_disable_layout_pipeline: Boolean(featureFlags.disableLayoutPipeline),
      feature_disable_translation_cache: Boolean(featureFlags.disableTranslationCache),
      feature_disable_strict_quality_gate: Boolean(featureFlags.disableStrictQualityGate),
      queue_depth: queueDepth,
      queue_busy: queueBusy
    });
  });

  router.get("/:id", requireApiKey, getLimiter, async (req, res) => {
    bump("jobs_get_total");
    const job = await ensureOwnedJob(req, res);
    if (!job) return;
    return res.status(200).json({
      job_id: job.id,
      status: job.status,
      progress_pct: job.progress_pct,
      error_code: job.error_code,
      selected_tier: job.selected_tier,
      provider_used: job.provider_used || null,
      provider_mode: job.provider_mode || "MODE_A",
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

  router.get("/:id/events", requireApiKey, getLimiter, async (req, res) => {
    bump("jobs_events_total");
    const job = await ensureOwnedJob(req, res);
    if (!job) return;
    const events = await deps.jobs.getEvents(req.params.id);
    return res.status(200).json({ job_id: req.params.id, events });
  });

  router.get("/:id/output", requireApiKey, getLimiter, async (req, res) => {
    bump("jobs_output_total");
    const job = await ensureOwnedJob(req, res);
    if (!job) return;
    if (job.status !== "READY") return res.status(409).json({ error: "job_not_ready" });

    const bytes = await deps.storage.readFile(job.output_file_path);
    res.setHeader("content-type", "application/pdf");
    return res.status(200).send(bytes);
  });

  return router;
}
