import express from "express";
import multer from "multer";
import { estimateStepUnits, validateAdmission, validateRuntimeStep } from "../routing/cost.guard.js";
import { getTierMultiplier, planRoute } from "../providers/provider.router.js";

const upload = multer({ storage: multer.memoryStorage() });
const ALLOWED_PACKAGES = new Set(["free", "pro", "premium"]);
const ALLOWED_MODES = new Set(["readable", "strict"]);
const ALLOWED_TIERS = new Set(["economy", "standard", "premium"]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  async function processJob({
    jobId,
    simulateFailTier,
    simulateFailTiers,
    simulateFailCode,
    simulateRetryOnceTiers,
    simulateLayoutMissingAnchorCount,
    simulateLayoutOverflowCount,
    workerDelayMs
  }) {
    const job = deps.jobs.get(jobId);
    if (!job) return { ok: false, error: "job_not_found" };

    if (workerDelayMs > 0) {
      await sleep(workerDelayMs);
    }

    const inBytes = await deps.storage.readFile(job.input_file_path);
    const route = planRoute({ packageName: job.package_name || "free", mode: job.mode || "readable" });
    const baseStepUnits = estimateStepUnits({ fileSizeBytes: inBytes.length, mode: route.mode });
    const spentUnits = job.billing?.charged_units || 0;
    let lastError = "ROUTER_NO_FALLBACK_PATH";

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
        billing: { charged_units: spentUnits + stepUnits, charged: true }
      });
      bump("jobs_ready_total");

      return { ok: true };
    }

    deps.jobs.update(job.id, {
      status: "FAILED",
      progress_pct: 100,
      error_code: lastError,
      quality_gate_passed: lastError === "LAYOUT_QUALITY_GATE_BLOCK" ? false : null,
      quality_gate_reason: lastError === "LAYOUT_QUALITY_GATE_BLOCK" ? "strict_layout_guard" : null
    });
    bump("jobs_failed_total");

    return { ok: false, error: lastError };
  }

  // Expose process fn to server queue adapter
  deps.processJob = processJob;

  router.post("/", upload.single("file"), async (req, res) => {
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
      target_lang: targetLang,
      source_lang: sourceLang,
      input_file_path: ""
    });

    const inputPath = await deps.storage.saveInput(temp.id, file.originalname || "input.pdf", file.buffer);
    deps.jobs.update(temp.id, {
      input_file_path: inputPath,
      package_name: packageName,
      mode,
      budget_units: admission.budgetUnits
    });

    return res.status(201).json({ job_id: temp.id, status: "PENDING" });
  });

  router.post("/:id/run", async (req, res) => {
    bump("jobs_run_total");
    const job = deps.jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: "job_not_found" });
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
    const workerDelayRaw = Number(req.query?.worker_delay_ms || 0);
    if (!Number.isFinite(workerDelayRaw)) return res.status(400).json({ error: "invalid_input" });
    if (!Number.isFinite(simulateLayoutMissingAnchorCount) || !Number.isFinite(simulateLayoutOverflowCount)) {
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

    deps.jobs.update(job.id, { status: "PROCESSING", progress_pct: 30 });

    if (asyncMode) {
      if (deps.queue && typeof deps.queue.enqueue === "function") {
        deps.queue.enqueue({
          jobId: job.id,
          simulateFailTier,
          simulateFailTiers,
          simulateFailCode,
          simulateRetryOnceTiers,
          simulateLayoutMissingAnchorCount,
          simulateLayoutOverflowCount,
          workerDelayMs
        });
      } else {
        void processJob({
          jobId: job.id,
          simulateFailTier,
          simulateFailTiers,
          simulateFailCode,
          simulateRetryOnceTiers,
          simulateLayoutMissingAnchorCount,
          simulateLayoutOverflowCount,
          workerDelayMs
        });
      }
      return res.status(202).json({ accepted: true, job_id: job.id, status: "PROCESSING" });
    }

    const result = await processJob({
      jobId: job.id,
      simulateFailTier,
      simulateFailTiers,
      simulateFailCode,
      simulateRetryOnceTiers,
      simulateLayoutMissingAnchorCount,
      simulateLayoutOverflowCount,
      workerDelayMs
    });
    if (!result.ok) {
      return res.status(409).json({ error: result.error });
    }

    return res.status(202).json({ accepted: true, job_id: job.id, status: "PROCESSING" });
  });

  router.get("/metrics", (req, res) => {
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
      queue_depth: queueDepth,
      queue_busy: queueBusy
    });
  });

  router.get("/:id", (req, res) => {
    bump("jobs_get_total");
    const job = deps.jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: "job_not_found" });
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
      last_transition_at: job.last_transition_at,
      billing: job.billing
    });
  });

  router.get("/:id/events", (req, res) => {
    bump("jobs_events_total");
    const events = deps.jobs.getEvents(req.params.id);
    if (!events) return res.status(404).json({ error: "job_not_found" });
    return res.status(200).json({ job_id: req.params.id, events });
  });

  router.get("/:id/output", async (req, res) => {
    bump("jobs_output_total");
    const job = deps.jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: "job_not_found" });
    if (job.status !== "READY") return res.status(409).json({ error: "job_not_ready" });

    const bytes = await deps.storage.readFile(job.output_file_path);
    res.setHeader("content-type", "application/pdf");
    return res.status(200).send(bytes);
  });

  return router;
}
