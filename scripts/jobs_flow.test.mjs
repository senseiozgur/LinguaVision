import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const backendDir = path.join(repoRoot, "backend");
const port = 8792;
const baseUrl = `http://127.0.0.1:${port}`;
const API_KEY = "lv-test-key";
const rawFetch = globalThis.fetch.bind(globalThis);

const notes = [];
let server;

async function apiFetch(url, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("x-api-key", API_KEY);
  return rawFetch(url, { ...init, headers });
}

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServerReady(timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await apiFetch(`${baseUrl}/jobs/non-existent-id`);
      if (res.status === 404) return;
    } catch {
      // keep polling
    }
    await wait(250);
  }
  throw new Error("server did not become ready");
}

async function postJob({ targetLang = "tr", packageName = "free", remainingUnits } = {}) {
  return postJobWithSize({ targetLang, packageName, remainingUnits, fileSizeBytes: 6 });
}

async function postJobWithSize({ targetLang = "tr", packageName = "free", remainingUnits, mode, fileSizeBytes = 6 } = {}) {
  const form = new FormData();
  form.append("target_lang", targetLang);
  form.append("package", packageName);
  if (mode !== undefined) form.append("mode", String(mode));
  if (remainingUnits !== undefined) form.append("remaining_units", String(remainingUnits));
  const pdfBytes = new Uint8Array(fileSizeBytes);
  pdfBytes[0] = 0x25;
  pdfBytes[1] = 0x50;
  pdfBytes[2] = 0x44;
  pdfBytes[3] = 0x46;
  pdfBytes[4] = 0x0a;
  pdfBytes[5] = 0x25;
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  form.append("file", blob, "sample.pdf");
  return apiFetch(`${baseUrl}/jobs`, { method: "POST", body: form });
}

async function postJobRaw(fields = {}) {
  const form = new FormData();
  if (fields.target_lang !== undefined) form.append("target_lang", String(fields.target_lang));
  if (fields.package !== undefined) form.append("package", String(fields.package));
  if (fields.mode !== undefined) form.append("mode", String(fields.mode));
  if (fields.source_lang !== undefined) form.append("source_lang", String(fields.source_lang));
  if (fields.remaining_units !== undefined) form.append("remaining_units", String(fields.remaining_units));
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x0a, 0x25]);
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  form.append("file", blob, "sample.pdf");
  return apiFetch(`${baseUrl}/jobs`, { method: "POST", body: form });
}

async function getJob(jobId) {
  const res = await apiFetch(`${baseUrl}/jobs/${jobId}`);
  return res.json();
}

async function waitForJobStatus(jobId, expectedStatus, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = await getJob(jobId);
    if (job.status === expectedStatus) return job;
    await wait(80);
  }
  throw new Error(`job ${jobId} did not reach ${expectedStatus} within ${timeoutMs}ms`);
}

async function main() {
  try {
    server = spawn(process.execPath, ["src/server.js"], {
      cwd: backendDir,
      env: {
        ...process.env,
        PORT: String(port),
        TRANSLATION_CACHE_PERSIST: "0",
        BILLING_PROVIDER: "stub",
        LV_MODE_A_ALLOW_SIMULATED_SUCCESS: "1",
        LV_API_KEY: API_KEY,
        LV_MAX_UPLOAD_BYTES: "52428800",
        LV_RATE_LIMIT_CREATE_PER_MIN: "500",
        LV_RATE_LIMIT_RUN_PER_MIN: "500",
        LV_RATE_LIMIT_GET_PER_MIN: "500"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    server.stdout.on("data", () => {});
    server.stderr.on("data", () => {});

    await waitForServerReady();
    notes.push("PASS backend server ready");

    // Baseline happy path + state transition
    const createRes = await postJob({ targetLang: "tr", packageName: "free", remainingUnits: 9999 });
    assert(createRes.status === 201, `create job status expected 201 got ${createRes.status}`);
    const created = await createRes.json();
    assert(created.job_id && created.status === "PENDING", "create response shape invalid");
    notes.push("PASS POST /jobs create contract (PENDING)");

    const runRes = await apiFetch(`${baseUrl}/jobs/${created.job_id}/run`, { method: "POST" });
    assert(runRes.status === 202, `run status expected 202 got ${runRes.status}`);
    const runJson = await runRes.json();
    assert(runJson.accepted === true && runJson.job_id === created.job_id, "run response shape invalid");
    assert(runJson.status === "QUEUED", "run response should be QUEUED");
    notes.push("PASS POST /jobs/:id/run contract (PROCESSING)");

    const rerunRes = await apiFetch(`${baseUrl}/jobs/${created.job_id}/run`, { method: "POST" });
    assert(rerunRes.status === 202, `rerun status expected 202 got ${rerunRes.status}`);
    const rerunJson = await rerunRes.json();
    assert(rerunJson.idempotent === true, "rerun should be idempotent");
    notes.push("PASS POST /jobs/:id/run idempotent re-run contract");

    const job = await waitForJobStatus(created.job_id, "READY", 5000);
    assert(job.status === "READY" && Number.isFinite(job.progress_pct), "job state expected READY");
    assert(typeof job.selected_tier === "string", "selected_tier should be present");
    assert(typeof job.layout_metrics?.anchor_count === "number", "layout_metrics.anchor_count should be present");
    assert(typeof job.translation_cache_hit === "boolean", "translation_cache_hit should be present");
    assert(typeof job.cost_delta_units === "number", "cost_delta_units should be present");
    assert(job.quality_gate_passed === null || typeof job.quality_gate_passed === "boolean", "quality_gate_passed type");
    assert(typeof job.last_transition_at === "string", "last_transition_at should be present");
    notes.push("PASS GET /jobs/:id READY state transition");

    const eventsRes = await apiFetch(`${baseUrl}/jobs/${created.job_id}/events`);
    assert(eventsRes.status === 200, `events status expected 200 got ${eventsRes.status}`);
    const eventsJson = await eventsRes.json();
    const states = (eventsJson.events || []).map((e) => e.state);
    assert(states[0] === "PENDING", "events first state should be PENDING");
    assert(states.includes("PROCESSING"), "events should include PROCESSING");
    assert(states.includes("READY"), "events should include READY");
    notes.push("PASS /jobs/:id/events success transition trace");

    const outputRes = await apiFetch(`${baseUrl}/jobs/${created.job_id}/output`);
    assert(outputRes.status === 200, `output status expected 200 got ${outputRes.status}`);
    const ct = outputRes.headers.get("content-type") || "";
    assert(ct.includes("application/pdf"), "output content-type should be application/pdf");
    notes.push("PASS GET /jobs/:id/output contract");

    // Same-document cache check: second job with same content should hit adapter cache
    const cacheCreateRes = await postJob({ targetLang: "tr", packageName: "free", remainingUnits: 9999 });
    assert(cacheCreateRes.status === 201, `cache create expected 201 got ${cacheCreateRes.status}`);
    const cacheJob = await cacheCreateRes.json();
    const cacheRunRes = await apiFetch(`${baseUrl}/jobs/${cacheJob.job_id}/run`, { method: "POST" });
    assert(cacheRunRes.status === 202, `cache run expected 202 got ${cacheRunRes.status}`);
    const cacheGet = await waitForJobStatus(cacheJob.job_id, "READY", 5000);
    assert(cacheGet.status === "READY", `cache job expected READY got ${cacheGet.status}`);
    assert(cacheGet.translation_cache_hit === true, "second same-doc run should set translation_cache_hit=true");
    notes.push("PASS deterministic translation cache hit on repeated same-document job");

    // Client remaining_units should not influence server-side admission decisions.
    const remainingUnitsZero = await postJob({ targetLang: "tr", packageName: "free", remainingUnits: 0 });
    assert(remainingUnitsZero.status === 201, `remaining_units=0 expected 201 got ${remainingUnitsZero.status}`);
    const remainingUnitsHigh = await postJob({ targetLang: "tr", packageName: "free", remainingUnits: 999999 });
    assert(remainingUnitsHigh.status === 201, `remaining_units=999999 expected 201 got ${remainingUnitsHigh.status}`);
    notes.push("PASS client remaining_units ignored by admission");

    // Baseline hardening: invalid package should fail fast
    const invalidPkgRes = await postJob({ targetLang: "tr", packageName: "enterprise", remainingUnits: 100 });
    assert(invalidPkgRes.status === 400, `invalid package expected 400 got ${invalidPkgRes.status}`);
    notes.push("PASS invalid package rejected");

    const invalidLangRes = await postJobRaw({ target_lang: "turkish", package: "free", remaining_units: 100 });
    assert(invalidLangRes.status === 400, `invalid target_lang expected 400 got ${invalidLangRes.status}`);
    notes.push("PASS invalid target_lang rejected");

    const invalidSourceLangRes = await postJobRaw({
      target_lang: "tr",
      source_lang: "english",
      package: "free",
      remaining_units: 100
    });
    assert(invalidSourceLangRes.status === 400, `invalid source_lang expected 400 got ${invalidSourceLangRes.status}`);
    notes.push("PASS invalid source_lang rejected");

    // Package enforcement matrix: free strict is denied by policy
    const freeStrictRes = await postJobWithSize({
      targetLang: "tr",
      packageName: "free",
      mode: "strict",
      remainingUnits: 9999,
      fileSizeBytes: 6
    });
    assert(freeStrictRes.status === 409, `free strict expected 409 got ${freeStrictRes.status}`);
    const freeStrictJson = await freeStrictRes.json();
    assert(
      freeStrictJson.error === "INPUT_LIMIT_EXCEEDED",
      `free strict expected INPUT_LIMIT_EXCEEDED got ${freeStrictJson.error}`
    );
    notes.push("PASS package rule free+strict denied");

    // Package enforcement matrix: free size cap vs pro size allowance
    const bigBytes = 26 * 1024 * 1024;
    const freeBigRes = await postJobWithSize({
      targetLang: "tr",
      packageName: "free",
      remainingUnits: 9999,
      fileSizeBytes: bigBytes
    });
    assert(freeBigRes.status === 409, `free big file expected 409 got ${freeBigRes.status}`);
    const freeBigJson = await freeBigRes.json();
    assert(
      freeBigJson.error === "INPUT_LIMIT_EXCEEDED",
      `free big file expected INPUT_LIMIT_EXCEEDED got ${freeBigJson.error}`
    );
    const proBigRes = await postJobWithSize({
      targetLang: "tr",
      packageName: "pro",
      remainingUnits: 9999,
      fileSizeBytes: bigBytes
    });
    assert(proBigRes.status === 201, `pro big file expected 201 got ${proBigRes.status}`);
    notes.push("PASS package size matrix free deny / pro allow");

    // Provider fallback: one tier fail -> next tier success
    const createFallbackRes = await postJob({ targetLang: "tr", packageName: "pro", remainingUnits: 9999 });
    assert(createFallbackRes.status === 201, `fallback create expected 201 got ${createFallbackRes.status}`);
    const fallbackJob = await createFallbackRes.json();

    const fallbackRunRes = await apiFetch(
      `${baseUrl}/jobs/${fallbackJob.job_id}/run?simulate_fail_tiers=standard`,
      { method: "POST" }
    );
    assert(fallbackRunRes.status === 202, `fallback run expected 202 got ${fallbackRunRes.status}`);

    const fallbackGet = await waitForJobStatus(fallbackJob.job_id, "READY", 5000);
    assert(fallbackGet.status === "READY", "fallback job should end READY");
    assert((fallbackGet.billing?.charged_units || 0) >= 1, "fallback should remain charged");
    assert(typeof fallbackGet.cost_delta_units === "number", "fallback cost_delta_units should be present");
    notes.push("PASS provider fallback one-tier-fail then success");

    // Provider fallback: all tiers fail -> FAILED + normalized error_code
    const createFailRes = await postJob({ targetLang: "tr", packageName: "pro", remainingUnits: 9999 });
    assert(createFailRes.status === 201, `fail create expected 201 got ${createFailRes.status}`);
    const failJob = await createFailRes.json();

    const failRunRes = await apiFetch(
      `${baseUrl}/jobs/${failJob.job_id}/run?simulate_fail_tiers=standard,premium,economy&simulate_fail_code=PROVIDER_TIMEOUT`,
      { method: "POST" }
    );
    assert(failRunRes.status === 202, `all-fail run expected 202 got ${failRunRes.status}`);

    const failGet = await waitForJobStatus(failJob.job_id, "FAILED", 5000);
    assert(failGet.status === "FAILED", `failed state expected FAILED got ${failGet.status}`);
    assert(
      failGet.error_code === "PROVIDER_TIMEOUT",
      `failed error_code expected PROVIDER_TIMEOUT got ${failGet.error_code}`
    );
    assert(failGet.ux_hint === "retry_or_fallback", `failed ux_hint expected retry_or_fallback got ${failGet.ux_hint}`);
    assert(failGet.billing?.refunded === true, "failed job should be refunded once");
    notes.push("PASS provider all-tier-fail -> FAILED + normalized error");

    const failRerunRes = await apiFetch(`${baseUrl}/jobs/${failJob.job_id}/run`, { method: "POST" });
    assert(failRerunRes.status === 409, `failed rerun expected 409 got ${failRerunRes.status}`);
    const failRerun = await failRerunRes.json();
    assert(failRerun.error === "job_already_running", `failed rerun expected job_already_running got ${failRerun.error}`);
    const failGetAfterRerun = await getJob(failJob.job_id);
    assert(
      failGetAfterRerun.billing?.charged_units === failGet.billing?.charged_units,
      "failed rerun should not charge again"
    );
    notes.push("PASS retry run after failure does not double-charge");

    const failEventsRes = await apiFetch(`${baseUrl}/jobs/${failJob.job_id}/events`);
    assert(failEventsRes.status === 200, `failed events status expected 200 got ${failEventsRes.status}`);
    const failEvents = await failEventsRes.json();
    const failStates = (failEvents.events || []).map((e) => e.state);
    assert(failStates.includes("PROCESSING"), "failed events should include PROCESSING");
    assert(failStates.includes("FAILED"), "failed events should include FAILED");
    notes.push("PASS /jobs/:id/events failure transition trace");

    const failOutputRes = await apiFetch(`${baseUrl}/jobs/${failJob.job_id}/output`);
    assert(failOutputRes.status === 409, `failed output expected 409 got ${failOutputRes.status}`);
    notes.push("PASS failed output contract job_not_ready");

    // Async queue simulation toggle: PROCESSING visible before READY
    const asyncCreateRes = await postJob({ targetLang: "tr", packageName: "free", remainingUnits: 9999 });
    assert(asyncCreateRes.status === 201, `async create expected 201 got ${asyncCreateRes.status}`);
    const asyncJob = await asyncCreateRes.json();
    const asyncRunRes = await apiFetch(
      `${baseUrl}/jobs/${asyncJob.job_id}/run?async=1&worker_delay_ms=250`,
      { method: "POST" }
    );
    assert(asyncRunRes.status === 202, `async run expected 202 got ${asyncRunRes.status}`);
    const midRes = await apiFetch(`${baseUrl}/jobs/${asyncJob.job_id}`);
    const midJob = await midRes.json();
    assert(["QUEUED", "PROCESSING"].includes(midJob.status), `mid state expected QUEUED/PROCESSING got ${midJob.status}`);
    const doneJob = await waitForJobStatus(asyncJob.job_id, "READY", 5000);
    assert(doneJob.status === "READY", `final async state expected READY got ${doneJob.status}`);
    notes.push("PASS async worker-delay simulation for polling");

    // Async failure simulation: PROCESSING visible first, then FAILED with normalized error
    const asyncFailCreateRes = await postJob({ targetLang: "tr", packageName: "pro", remainingUnits: 9999 });
    assert(asyncFailCreateRes.status === 201, `async fail create expected 201 got ${asyncFailCreateRes.status}`);
    const asyncFailJob = await asyncFailCreateRes.json();
    const asyncFailRunRes = await apiFetch(
      `${baseUrl}/jobs/${asyncFailJob.job_id}/run?async=1&worker_delay_ms=200&simulate_fail_tiers=standard,premium,economy&simulate_fail_code=PROVIDER_TIMEOUT`,
      { method: "POST" }
    );
    assert(asyncFailRunRes.status === 202, `async fail run expected 202 got ${asyncFailRunRes.status}`);
    const asyncMidRes = await apiFetch(`${baseUrl}/jobs/${asyncFailJob.job_id}`);
    const asyncMidJob = await asyncMidRes.json();
    assert(
      ["QUEUED", "PROCESSING"].includes(asyncMidJob.status),
      `async fail mid expected QUEUED/PROCESSING got ${asyncMidJob.status}`
    );
    const asyncFailDone = await waitForJobStatus(asyncFailJob.job_id, "FAILED", 5000);
    assert(asyncFailDone.status === "FAILED", `async fail final expected FAILED got ${asyncFailDone.status}`);
    assert(
      asyncFailDone.error_code === "PROVIDER_TIMEOUT",
      `async fail error_code expected PROVIDER_TIMEOUT got ${asyncFailDone.error_code}`
    );
    const asyncFailEventsRes = await apiFetch(`${baseUrl}/jobs/${asyncFailJob.job_id}/events`);
    const asyncFailEvents = await asyncFailEventsRes.json();
    const asyncFailStates = (asyncFailEvents.events || []).map((e) => e.state);
    assert(asyncFailStates.includes("PROCESSING"), "async fail events should include PROCESSING");
    assert(asyncFailStates.includes("FAILED"), "async fail events should include FAILED");
    notes.push("PASS async failure simulation for polling + events");

    // Error normalization: known provider code should be preserved
    const knownErrCreateRes = await postJob({ targetLang: "tr", packageName: "pro", remainingUnits: 9999 });
    assert(knownErrCreateRes.status === 201, `known error create expected 201 got ${knownErrCreateRes.status}`);
    const knownErrJob = await knownErrCreateRes.json();
    const knownErrRunRes = await apiFetch(
      `${baseUrl}/jobs/${knownErrJob.job_id}/run?simulate_fail_tiers=standard,premium,economy&simulate_fail_code=PROVIDER_RATE_LIMIT`,
      { method: "POST" }
    );
    assert(knownErrRunRes.status === 202, `known error run expected 202 got ${knownErrRunRes.status}`);
    const knownErrJobFinal = await waitForJobStatus(knownErrJob.job_id, "FAILED", 5000);
    assert(
      knownErrJobFinal.error_code === "PROVIDER_RATE_LIMIT",
      `known error should preserve PROVIDER_RATE_LIMIT got ${knownErrJobFinal.error_code}`
    );
    notes.push("PASS known provider error code preserved");

    // Error normalization: unknown provider error should map to PROVIDER_UPSTREAM_5XX
    const unknownErrCreateRes = await postJob({ targetLang: "tr", packageName: "pro", remainingUnits: 9999 });
    assert(unknownErrCreateRes.status === 201, `unknown error create expected 201 got ${unknownErrCreateRes.status}`);
    const unknownErrJob = await unknownErrCreateRes.json();
    const unknownErrRunRes = await apiFetch(
      `${baseUrl}/jobs/${unknownErrJob.job_id}/run?simulate_fail_tiers=standard,premium,economy&simulate_fail_code=RANDOM_PROVIDER_ERROR`,
      { method: "POST" }
    );
    assert(unknownErrRunRes.status === 202, `unknown error run expected 202 got ${unknownErrRunRes.status}`);
    const unknownErrJobFinal = await waitForJobStatus(unknownErrJob.job_id, "FAILED", 5000);
    assert(
      unknownErrJobFinal.error_code === "PROVIDER_UPSTREAM_5XX",
      `unknown error should normalize to PROVIDER_UPSTREAM_5XX got ${unknownErrJobFinal.error_code}`
    );
    notes.push("PASS unknown provider error normalized to PROVIDER_UPSTREAM_5XX");

    // Provider outage matrix: upstream 5xx must propagate and map to retry/fallback UX hint
    const upstreamErrCreateRes = await postJob({ targetLang: "tr", packageName: "pro", remainingUnits: 9999 });
    assert(upstreamErrCreateRes.status === 201, `upstream error create expected 201 got ${upstreamErrCreateRes.status}`);
    const upstreamErrJob = await upstreamErrCreateRes.json();
    const upstreamErrRunRes = await apiFetch(
      `${baseUrl}/jobs/${upstreamErrJob.job_id}/run?simulate_fail_tiers=standard,premium,economy&simulate_fail_code=PROVIDER_UPSTREAM_5XX`,
      { method: "POST" }
    );
    assert(upstreamErrRunRes.status === 202, `upstream error run expected 202 got ${upstreamErrRunRes.status}`);
    const upstreamErrGet = await waitForJobStatus(upstreamErrJob.job_id, "FAILED", 5000);
    assert(upstreamErrGet.status === "FAILED", `upstream job expected FAILED got ${upstreamErrGet.status}`);
    assert(
      upstreamErrGet.ux_hint === "retry_or_fallback",
      `upstream ux_hint expected retry_or_fallback got ${upstreamErrGet.ux_hint}`
    );
    notes.push("PASS provider upstream outage matrix mapping");

    // Timeout policy tuning: simulated provider latency above threshold should fail as timeout
    const timeoutCreateRes = await postJob({ targetLang: "tr", packageName: "free", remainingUnits: 9999 });
    assert(timeoutCreateRes.status === 201, `timeout create expected 201 got ${timeoutCreateRes.status}`);
    const timeoutJob = await timeoutCreateRes.json();
    const timeoutRunRes = await apiFetch(
      `${baseUrl}/jobs/${timeoutJob.job_id}/run?simulate_provider_latency_ms=40&provider_timeout_ms=1`,
      { method: "POST" }
    );
    assert(timeoutRunRes.status === 202, `timeout run expected 202 got ${timeoutRunRes.status}`);
    const timeoutGet = await waitForJobStatus(timeoutJob.job_id, "FAILED", 5000);
    assert(
      timeoutGet.error_code === "PROVIDER_TIMEOUT",
      `timeout run expected PROVIDER_TIMEOUT got ${timeoutGet.error_code}`
    );
    assert(timeoutGet.billing?.refunded === true, "timeout failure should trigger refund");
    notes.push("PASS provider timeout policy tuning via query params");

    // Retry policy simulation: same tier one retry should recover without fallback
    const retryCreateRes = await postJob({ targetLang: "tr", packageName: "pro", remainingUnits: 9999 });
    assert(retryCreateRes.status === 201, `retry create expected 201 got ${retryCreateRes.status}`);
    const retryJob = await retryCreateRes.json();
    const retryRunRes = await apiFetch(
      `${baseUrl}/jobs/${retryJob.job_id}/run?simulate_retry_once_tiers=standard`,
      { method: "POST" }
    );
    assert(retryRunRes.status === 202, `retry run expected 202 got ${retryRunRes.status}`);
    const retryGet = await waitForJobStatus(retryJob.job_id, "READY", 5000);
    assert(retryGet.status === "READY", `retry job expected READY got ${retryGet.status}`);
    assert(retryGet.selected_tier === "standard", `retry should stay on standard got ${retryGet.selected_tier}`);
    notes.push("PASS same-tier single retry recovers without fallback escalation");

    // Queue ordering: second async job must not finish before first in single-worker queue
    const q1CreateRes = await postJob({ targetLang: "tr", packageName: "free", remainingUnits: 9999 });
    assert(q1CreateRes.status === 201, `q1 create expected 201 got ${q1CreateRes.status}`);
    const q1 = await q1CreateRes.json();
    const q2CreateRes = await postJob({ targetLang: "tr", packageName: "free", remainingUnits: 9999 });
    assert(q2CreateRes.status === 201, `q2 create expected 201 got ${q2CreateRes.status}`);
    const q2 = await q2CreateRes.json();

    const q1RunRes = await apiFetch(`${baseUrl}/jobs/${q1.job_id}/run?async=1&worker_delay_ms=500`, { method: "POST" });
    assert(q1RunRes.status === 202, `q1 async run expected 202 got ${q1RunRes.status}`);
    const q2RunRes = await apiFetch(`${baseUrl}/jobs/${q2.job_id}/run?async=1`, { method: "POST" });
    assert(q2RunRes.status === 202, `q2 async run expected 202 got ${q2RunRes.status}`);

    await wait(150);
    const q2Mid = await getJob(q2.job_id);
    assert(["QUEUED", "PROCESSING"].includes(q2Mid.status), `q2 mid status expected QUEUED/PROCESSING got ${q2Mid.status}`);
    assert(!q2Mid.selected_tier, "q2 should not be selected before worker executes");

    const q1Ready = await waitForJobStatus(q1.job_id, "READY");
    const q2Ready = await waitForJobStatus(q2.job_id, "READY");
    assert(
      Date.parse(q2Ready.last_transition_at) >= Date.parse(q1Ready.last_transition_at),
      "q2 must not transition to READY before q1 in single-worker queue"
    );
    notes.push("PASS single-worker queue ordering preserved for async jobs");

    const notFoundRes = await apiFetch(`${baseUrl}/jobs/nope/run`, { method: "POST" });
    assert(notFoundRes.status === 404, `run missing job expected 404 got ${notFoundRes.status}`);
    notes.push("PASS job_not_found contract");

    const badRunCreateRes = await postJob({ targetLang: "tr", packageName: "free", remainingUnits: 9999 });
    assert(badRunCreateRes.status === 201, `bad run create expected 201 got ${badRunCreateRes.status}`);
    const badRunJob = await badRunCreateRes.json();
    const badRunRes = await apiFetch(`${baseUrl}/jobs/${badRunJob.job_id}/run?simulate_fail_tier=gold`, {
      method: "POST"
    });
    assert(badRunRes.status === 400, `invalid run tier expected 400 got ${badRunRes.status}`);
    notes.push("PASS invalid run tier rejected");

    // Strict quality gate: simulate missing anchors and ensure strict mode blocks output quality
    const strictCreateRes = await postJobRaw({
      target_lang: "tr",
      source_lang: "en",
      mode: "strict",
      package: "pro",
      remaining_units: 9999
    });
    assert(strictCreateRes.status === 201, `strict create expected 201 got ${strictCreateRes.status}`);
    const strictJob = await strictCreateRes.json();
    const strictRunRes = await apiFetch(
      `${baseUrl}/jobs/${strictJob.job_id}/run?simulate_layout_missing_anchor_count=2`,
      { method: "POST" }
    );
    assert(strictRunRes.status === 202, `strict quality gate run expected 202 got ${strictRunRes.status}`);
    const strictGet = await waitForJobStatus(strictJob.job_id, "FAILED", 5000);
    assert(strictGet.status === "FAILED", `strict job expected FAILED got ${strictGet.status}`);
    assert(
      strictGet.error_code === "LAYOUT_QUALITY_GATE_BLOCK",
      `strict quality gate expected LAYOUT_QUALITY_GATE_BLOCK got ${strictGet.error_code}`
    );
    assert(
      strictGet.ux_hint === "switch_mode_or_fix_pdf",
      `strict ux_hint expected switch_mode_or_fix_pdf got ${strictGet.ux_hint}`
    );
    notes.push("PASS strict quality gate blocks missing-anchor output");

    const eventsMissingRes = await apiFetch(`${baseUrl}/jobs/nope/events`);
    assert(eventsMissingRes.status === 404, `events missing job expected 404 got ${eventsMissingRes.status}`);
    notes.push("PASS events job_not_found contract");

    const metricsRes = await apiFetch(`${baseUrl}/jobs/metrics`);
    assert(metricsRes.status === 200, `metrics status expected 200 got ${metricsRes.status}`);
    const metrics = await metricsRes.json();
    assert(typeof metrics.jobs_create_total === "number", "metrics jobs_create_total should be number");
    assert(typeof metrics.jobs_run_total === "number", "metrics jobs_run_total should be number");
    assert(typeof metrics.queue_depth === "number", "metrics queue_depth should be number");
    assert(typeof metrics.cache_hits_total === "number", "metrics cache_hits_total should be number");
    assert(typeof metrics.cache_evictions_total === "number", "metrics cache_evictions_total should be number");
    assert(typeof metrics.cache_entries === "number", "metrics cache_entries should be number");
    assert(typeof metrics.provider_retry_total === "number", "metrics provider_retry_total should be number");
    assert(typeof metrics.provider_fallback_total === "number", "metrics provider_fallback_total should be number");
    assert(typeof metrics.jobs_ready_total === "number", "metrics jobs_ready_total should be number");
    assert(typeof metrics.jobs_failed_total === "number", "metrics jobs_failed_total should be number");
    assert(typeof metrics.provider_calls_total === "number", "metrics provider_calls_total should be number");
    assert(typeof metrics.provider_latency_avg_ms === "number", "metrics provider_latency_avg_ms should be number");
    assert(typeof metrics.feature_disable_layout_pipeline === "boolean", "metrics feature_disable_layout_pipeline bool");
    assert(
      typeof metrics.feature_disable_translation_cache === "boolean",
      "metrics feature_disable_translation_cache bool"
    );
    assert(
      typeof metrics.feature_disable_strict_quality_gate === "boolean",
      "metrics feature_disable_strict_quality_gate bool"
    );
    assert(metrics.provider_retry_total >= 1, "metrics provider_retry_total should be >=1");
    assert(metrics.provider_fallback_total >= 1, "metrics provider_fallback_total should be >=1");
    notes.push("PASS /jobs/metrics minimal observability contract");

    console.log("PASS");
    console.log("AUDIT SUMMARY:");
    for (const n of notes) console.log(`- ${n}`);
    process.exitCode = 0;
  } catch (err) {
    console.log("FAIL");
    console.log("AUDIT SUMMARY:");
    for (const n of notes) console.log(`- ${n}`);
    console.log(`- FAIL ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (server && !server.killed) {
      server.kill("SIGTERM");
    }
  }
}

await main();

