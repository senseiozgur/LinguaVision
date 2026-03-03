import express from "express";
import multer from "multer";
import { estimateStepUnits, validateAdmission, validateRuntimeStep } from "../routing/cost.guard.js";
import { getTierMultiplier, planRoute } from "../providers/provider.router.js";

const upload = multer({ storage: multer.memoryStorage() });

export function createJobsRouter(deps) {
  const router = express.Router();

  router.post("/", upload.single("file"), async (req, res) => {
    const file = req.file;
    const targetLang = req.body?.target_lang;
    const packageName = req.body?.package || "free";
    const mode = req.body?.mode || "readable";
    const remainingUnits = req.body?.remaining_units ? Number(req.body.remaining_units) : null;
    if (!file) return res.status(400).json({ error: "invalid_input" });
    if (!targetLang) return res.status(400).json({ error: "invalid_input" });

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

    const simulateFailTier = (req.query?.simulate_fail_tier || "").toString() || null;
    const simulateFailTiers = (req.query?.simulate_fail_tiers || "")
      .toString()
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    deps.jobs.update(job.id, { status: "PROCESSING", progress_pct: 30 });
    const inBytes = await deps.storage.readFile(job.input_file_path);

    const route = planRoute({ packageName: job.package_name || "free", mode: job.mode || "readable" });
    const baseStepUnits = estimateStepUnits({ fileSizeBytes: inBytes.length, mode: route.mode });
    let spentUnits = job.billing?.charged_units || 0;
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

      const translated = await deps.providerAdapter.translateDocument({
        inputBuffer: inBytes,
        tier,
        mode: route.mode,
        simulateFailTier,
        simulateFailTiers
      });

      if (!translated.ok) {
        lastError = translated.error || "PROVIDER_TIMEOUT";
        continue;
      }

      const outPath = await deps.storage.saveOutput(job.id, translated.outputBuffer);
      deps.jobs.update(job.id, {
        status: "READY",
        progress_pct: 100,
        output_file_path: outPath,
        selected_tier: tier,
        billing: { charged_units: spentUnits + stepUnits, charged: true }
      });

      return res.status(202).json({ accepted: true, job_id: job.id, status: "PROCESSING" });
    }

    deps.jobs.update(job.id, {
      status: "FAILED",
      progress_pct: 100,
      error_code: lastError
    });

    return res.status(409).json({ error: lastError });
  });

  router.get("/:id", (req, res) => {
    const job = deps.jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: "job_not_found" });
    return res.status(200).json({
      job_id: job.id,
      status: job.status,
      progress_pct: job.progress_pct,
      error_code: job.error_code,
      billing: job.billing
    });
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
