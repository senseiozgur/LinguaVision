import express from "express";
import multer from "multer";
import { estimateStepUnits, validateAdmission, validateRuntimeStep } from "../routing/cost.guard.js";
import { getTierMultiplier, planRoute } from "../providers/provider.router.js";

const upload = multer({ storage: multer.memoryStorage() });
const ALLOWED_PACKAGES = new Set(["free", "pro", "premium"]);
const ALLOWED_MODES = new Set(["readable", "strict"]);
const ALLOWED_TIERS = new Set(["economy", "standard", "premium"]);
const KNOWN_PROVIDER_ERRORS = new Set([
  "PROVIDER_RATE_LIMIT",
  "PROVIDER_TIMEOUT",
  "PROVIDER_UPSTREAM_5XX"
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeProviderError(code) {
  if (KNOWN_PROVIDER_ERRORS.has(code)) return code;
  return "PROVIDER_UPSTREAM_5XX";
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

export function createJobsRouter(deps) {
  const router = express.Router();

  async function processJob({
    jobId,
    simulateFailTier,
    simulateFailTiers,
    simulateFailCode,
    simulateRetryOnceTiers,
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

    for (const tier of route.chain) {
      const stepUnits = Math.ceil(baseStepUnits * getTierMultiplier(tier));
      const runtimeGuard = validateRuntimeStep({
        packageName: route.packageName,
        spentUnits,
        stepUnits
      });

      if (!runtimeGuard.ok) {
        lastError = runtimeGuard.error;
        continue;
      }

      let translated = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        translated = await deps.providerAdapter.translateDocument({
          inputBuffer: inBytes,
          tier,
          mode: route.mode,
          simulateFailTier,
          simulateFailTiers,
          simulateFailCode,
          simulateRetryOnceTiers,
          jobId: job.id
        });

        if (translated.ok) break;
        lastError = normalizeProviderError(translated.error);
      }

      if (!translated || !translated.ok) continue;

      const outPath = await deps.storage.saveOutput(job.id, translated.outputBuffer);
      deps.jobs.update(job.id, {
        status: "READY",
        progress_pct: 100,
        output_file_path: outPath,
        selected_tier: tier,
        billing: { charged_units: spentUnits + stepUnits, charged: true }
      });

      return { ok: true };
    }

    deps.jobs.update(job.id, {
      status: "FAILED",
      progress_pct: 100,
      error_code: lastError
    });

    return { ok: false, error: lastError };
  }

  // Expose process fn to server queue adapter
  deps.processJob = processJob;

  router.post("/", upload.single("file"), async (req, res) => {
    const file = req.file;
    const targetLang = (req.body?.target_lang || "").toString().trim();
    const packageName = (req.body?.package || "free").toString().trim().toLowerCase();
    const mode = (req.body?.mode || "readable").toString().trim().toLowerCase();
    const remainingUnitsRaw = req.body?.remaining_units;
    const remainingUnits = remainingUnitsRaw !== undefined ? Number(remainingUnitsRaw) : null;
    if (!file) return res.status(400).json({ error: "invalid_input" });
    if (!targetLang) return res.status(400).json({ error: "invalid_input" });
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
      source_lang: req.body?.source_lang || null,
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
    const job = deps.jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: "job_not_found" });
    if (job.status !== "PENDING") return res.status(409).json({ error: "job_already_running" });

    const simulateFailTier = (req.query?.simulate_fail_tier || "").toString().trim() || null;
    const simulateFailTiers = normalizeCsvParam(req.query?.simulate_fail_tiers);
    const simulateFailCode = (req.query?.simulate_fail_code || "").toString().trim() || "PROVIDER_TIMEOUT";
    const simulateRetryOnceTiers = normalizeCsvParam(req.query?.simulate_retry_once_tiers);
    const workerDelayRaw = Number(req.query?.worker_delay_ms || 0);
    if (!Number.isFinite(workerDelayRaw)) return res.status(400).json({ error: "invalid_input" });
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
          workerDelayMs
        });
      } else {
        void processJob({
          jobId: job.id,
          simulateFailTier,
          simulateFailTiers,
          simulateFailCode,
          simulateRetryOnceTiers,
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
      workerDelayMs
    });
    if (!result.ok) {
      return res.status(409).json({ error: result.error });
    }

    return res.status(202).json({ accepted: true, job_id: job.id, status: "PROCESSING" });
  });

  router.get("/:id", (req, res) => {
    const job = deps.jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: "job_not_found" });
    return res.status(200).json({
      job_id: job.id,
      status: job.status,
      progress_pct: job.progress_pct,
      error_code: job.error_code,
      selected_tier: job.selected_tier,
      last_transition_at: job.last_transition_at,
      billing: job.billing
    });
  });

  router.get("/:id/events", (req, res) => {
    const events = deps.jobs.getEvents(req.params.id);
    if (!events) return res.status(404).json({ error: "job_not_found" });
    return res.status(200).json({ job_id: req.params.id, events });
  });

  router.get("/:id/output", async (req, res) => {
    const job = deps.jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: "job_not_found" });
    if (job.status !== "READY") return res.status(409).json({ error: "job_not_ready" });

    const bytes = await deps.storage.readFile(job.output_file_path);
    res.setHeader("content-type", "application/pdf");
    return res.status(200).send(bytes);
  });

  return router;
}
