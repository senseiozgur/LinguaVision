import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { estimateStepUnits, validateAdmission, validateRuntimeStep } from "../backend/src/routing/cost.guard.js";
import { getFallbackChain, getTierMultiplier, planRoute } from "../backend/src/providers/provider.router.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const required = [
  "backend/package.json",
  "backend/src/server.js",
  "backend/src/routes/jobs.routes.js",
  "backend/src/jobs/job.store.js",
  "backend/src/jobs/job.queue.js",
  "backend/src/pdf/layout.pipeline.js",
  "backend/src/storage/local.storage.js",
  "backend/src/routing/cost.guard.js",
  "backend/src/providers/provider.router.js",
  "backend/src/providers/provider.adapter.js",
  "backend/src/providers/translation.cache.js"
];

let pass = true;
const notes = [];

for (const p of required) {
  const abs = path.join(root, p);
  const ok = fs.existsSync(abs);
  notes.push(`${ok ? "PASS" : "FAIL"} ${p}`);
  if (!ok) pass = false;
}

try {
  const stepReadable = estimateStepUnits({ fileSizeBytes: 5 * 1024 * 1024, mode: "readable" });
  const stepStrict = estimateStepUnits({ fileSizeBytes: 5 * 1024 * 1024, mode: "strict" });
  assert(stepStrict > stepReadable, "strict mode should consume more units");
  notes.push("PASS strict step units > readable");
} catch (err) {
  pass = false;
  notes.push(`FAIL strict/readable units: ${err.message}`);
}

try {
  const admissionBlocked = validateAdmission({
    packageName: "free",
    fileSizeBytes: 1 * 1024 * 1024,
    worstCaseUnits: 50,
    remainingUnits: 20
  });
  assert(!admissionBlocked.ok && admissionBlocked.error === "COST_GUARD_BLOCK", "admission should block");
  notes.push("PASS admission COST_GUARD_BLOCK");
} catch (err) {
  pass = false;
  notes.push(`FAIL admission guard: ${err.message}`);
}

try {
  const runtimeStop = validateRuntimeStep({ packageName: "free", spentUnits: 100, stepUnits: 30 });
  assert(!runtimeStop.ok && runtimeStop.error === "COST_LIMIT_STOP", "runtime should stop above budget");
  notes.push("PASS runtime COST_LIMIT_STOP");
} catch (err) {
  pass = false;
  notes.push(`FAIL runtime guard: ${err.message}`);
}

try {
  assert(getFallbackChain("free").join(">") === "economy>standard", "free chain mismatch");
  assert(getFallbackChain("pro").join(">") === "standard>premium>economy", "pro chain mismatch");
  assert(getFallbackChain("premium").join(">") === "premium>standard>economy", "premium chain mismatch");
  assert(getTierMultiplier("premium") > getTierMultiplier("economy"), "tier multiplier mismatch");
  const plan = planRoute({ packageName: "pro", mode: "strict" });
  assert(plan.maxEscalations === 2, "maxEscalations mismatch");
  notes.push("PASS provider fallback deterministic mapping");
} catch (err) {
  pass = false;
  notes.push(`FAIL provider fallback mapping: ${err.message}`);
}

const jobsRoute = fs.readFileSync(path.join(root, "backend/src/routes/jobs.routes.js"), "utf8");
const providerAdapter = fs.readFileSync(path.join(root, "backend/src/providers/provider.adapter.js"), "utf8");
const translationCache = fs.readFileSync(path.join(root, "backend/src/providers/translation.cache.js"), "utf8");
const pdfPipeline = fs.readFileSync(path.join(root, "backend/src/pdf/layout.pipeline.js"), "utf8");
const hasAdmissionGuard =
  jobsRoute.includes("validateAdmission") &&
  jobsRoute.includes("COST_GUARD_BLOCK") &&
  jobsRoute.includes("INPUT_LIMIT_EXCEEDED");
const hasRuntimeGuard =
  jobsRoute.includes("validateRuntimeStep") &&
  jobsRoute.includes("runtimeGuard.error");
const hasFallbackChain =
  jobsRoute.includes("planRoute") &&
  (jobsRoute.includes("for (const tier of route.chain)") ||
    jobsRoute.includes("for (let chainIndex = 0; chainIndex < route.chain.length; chainIndex++)") ||
    jobsRoute.includes("for (let chainIndex = 0; chainIndex < effectiveChain.length; chainIndex++)"));
const hasJobsCreateContract =
  jobsRoute.includes("res.status(201).json({ job_id: temp.id, status: \"PENDING\" })");
const hasJobsRunContract =
  jobsRoute.includes("res.status(202).json({ accepted: true, job_id: job.id, status: \"PROCESSING\" })") &&
  jobsRoute.includes("idempotent: true");
const hasJobsGetContract =
  jobsRoute.includes("job_id: job.id") &&
  jobsRoute.includes("status: job.status") &&
  jobsRoute.includes("progress_pct: job.progress_pct") &&
  jobsRoute.includes("error_code: job.error_code") &&
  jobsRoute.includes("selected_tier: job.selected_tier") &&
  jobsRoute.includes("layout_metrics: job.layout_metrics") &&
  jobsRoute.includes("translation_cache_hit: Boolean(job.translation_cache_hit)") &&
  jobsRoute.includes("quality_gate_passed: job.quality_gate_passed") &&
  jobsRoute.includes("quality_gate_reason: job.quality_gate_reason") &&
  jobsRoute.includes("cost_delta_units: job.cost_delta_units") &&
  jobsRoute.includes("last_transition_at: job.last_transition_at") &&
  jobsRoute.includes("billing: job.billing");
const hasJobsErrorCodes =
  jobsRoute.includes("{ error: \"job_not_found\" }") &&
  jobsRoute.includes("{ error: \"job_already_running\" }") &&
  jobsRoute.includes("{ error: \"job_not_ready\" }");
const hasEventsEndpoint =
  jobsRoute.includes("router.get(\"/:id/events\"") &&
  jobsRoute.includes("deps.jobs.getEvents");
const hasMetricsEndpoint =
  jobsRoute.includes("router.get(\"/metrics\"") &&
  jobsRoute.includes("jobs_create_total") &&
  jobsRoute.includes("provider_retry_total") &&
  jobsRoute.includes("provider_fallback_total") &&
  jobsRoute.includes("runtime_guard_block_total") &&
  jobsRoute.includes("queue_depth") &&
  jobsRoute.includes("getCacheMetrics");
const hasAsyncToggleWiring =
  jobsRoute.includes("const asyncRaw = req.query?.async") &&
  jobsRoute.includes("const asyncMode = asyncRaw === \"1\"") &&
  jobsRoute.includes("worker_delay_ms") &&
  (jobsRoute.includes("deps.queue.enqueue") || jobsRoute.includes("void processJob"));
const hasQueueWorkerWiring =
  jobsRoute.includes("deps.processJob = processJob") &&
  jobsRoute.includes("deps.queue.enqueue") &&
  fs.readFileSync(path.join(root, "backend/src/server.js"), "utf8").includes("new JobQueue");
const hasErrorNormalizationWiring =
  (jobsRoute.includes("normalizeProviderError") && jobsRoute.includes("KNOWN_PROVIDER_ERRORS")) ||
  (providerAdapter.includes("normalizeProviderError") && providerAdapter.includes("KNOWN_PROVIDER_ERRORS"));
const hasRetryPolicySimulationWiring =
  jobsRoute.includes("simulate_retry_once_tiers") &&
  jobsRoute.includes("for (let attempt = 1; attempt <= 2; attempt++)");
const hasStrictQualityGateWiring =
  jobsRoute.includes("effectiveChain = route.mode === \"strict\" ? [route.chain[0]] : route.chain") &&
  jobsRoute.includes("LAYOUT_QUALITY_GATE_BLOCK") &&
  jobsRoute.includes("simulate_layout_missing_anchor_count");
const hasLayoutPipelineWiring =
  providerAdapter.includes("runLayoutPipeline") &&
  providerAdapter.includes("layoutMetrics") &&
  pdfPipeline.includes("parsePdfLayout") &&
  pdfPipeline.includes("reflowTranslatedChunks");
const hasTranslationCacheWiring =
  providerAdapter.includes("translationCache") &&
  providerAdapter.includes("makeCacheKey") &&
  providerAdapter.includes("cacheHit") &&
  translationCache.includes("cache_evictions_total") &&
  translationCache.includes("saveToDisk");

notes.push(`${hasAdmissionGuard ? "PASS" : "FAIL"} admission guard wiring`);
notes.push(`${hasRuntimeGuard ? "PASS" : "FAIL"} runtime guard wiring`);
notes.push(`${hasFallbackChain ? "PASS" : "FAIL"} provider fallback chain wiring`);
notes.push(`${hasJobsCreateContract ? "PASS" : "FAIL"} jobs create response contract`);
notes.push(`${hasJobsRunContract ? "PASS" : "FAIL"} jobs run response contract`);
notes.push(`${hasJobsGetContract ? "PASS" : "FAIL"} jobs get response state contract`);
notes.push(`${hasJobsErrorCodes ? "PASS" : "FAIL"} jobs error code contract`);
notes.push(`${hasEventsEndpoint ? "PASS" : "FAIL"} jobs events endpoint contract`);
notes.push(`${hasMetricsEndpoint ? "PASS" : "FAIL"} jobs metrics endpoint contract`);
notes.push(`${hasAsyncToggleWiring ? "PASS" : "FAIL"} async queue simulation wiring`);
notes.push(`${hasQueueWorkerWiring ? "PASS" : "FAIL"} queue worker adapter wiring`);
notes.push(`${hasErrorNormalizationWiring ? "PASS" : "FAIL"} provider error normalization wiring`);
notes.push(`${hasRetryPolicySimulationWiring ? "PASS" : "FAIL"} retry policy simulation wiring`);
notes.push(`${hasLayoutPipelineWiring ? "PASS" : "FAIL"} layout pipeline wiring`);
notes.push(`${hasTranslationCacheWiring ? "PASS" : "FAIL"} translation cache wiring`);
notes.push(`${hasStrictQualityGateWiring ? "PASS" : "FAIL"} strict quality gate wiring`);
if (
  !hasAdmissionGuard ||
  !hasRuntimeGuard ||
  !hasFallbackChain ||
  !hasJobsCreateContract ||
  !hasJobsRunContract ||
  !hasJobsGetContract ||
  !hasJobsErrorCodes ||
  !hasEventsEndpoint ||
  !hasMetricsEndpoint ||
  !hasAsyncToggleWiring ||
  !hasQueueWorkerWiring ||
  !hasErrorNormalizationWiring ||
  !hasRetryPolicySimulationWiring ||
  !hasLayoutPipelineWiring ||
  !hasTranslationCacheWiring ||
  !hasStrictQualityGateWiring
) {
  pass = false;
}

console.log(pass ? "PASS" : "FAIL");
console.log("AUDIT SUMMARY:");
for (const n of notes) console.log(`- ${n}`);
process.exit(pass ? 0 : 1);
