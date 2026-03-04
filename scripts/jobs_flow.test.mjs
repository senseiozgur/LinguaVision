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

const notes = [];
let server;

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServerReady(timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/jobs/non-existent-id`);
      if (res.status === 404) return;
    } catch {
      // keep polling
    }
    await wait(250);
  }
  throw new Error("server did not become ready");
}

async function postJob({ targetLang = "tr", packageName = "free", remainingUnits } = {}) {
  const form = new FormData();
  form.append("target_lang", targetLang);
  form.append("package", packageName);
  if (remainingUnits !== undefined) form.append("remaining_units", String(remainingUnits));
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x0a, 0x25]); // %PDF\n%
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  form.append("file", blob, "sample.pdf");
  return fetch(`${baseUrl}/jobs`, { method: "POST", body: form });
}

async function getJob(jobId) {
  const res = await fetch(`${baseUrl}/jobs/${jobId}`);
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
      env: { ...process.env, PORT: String(port) },
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

    const runRes = await fetch(`${baseUrl}/jobs/${created.job_id}/run`, { method: "POST" });
    assert(runRes.status === 202, `run status expected 202 got ${runRes.status}`);
    const runJson = await runRes.json();
    assert(runJson.accepted === true && runJson.job_id === created.job_id, "run response shape invalid");
    assert(runJson.status === "PROCESSING", "run response should be PROCESSING");
    notes.push("PASS POST /jobs/:id/run contract (PROCESSING)");

    const getRes = await fetch(`${baseUrl}/jobs/${created.job_id}`);
    assert(getRes.status === 200, `get status expected 200 got ${getRes.status}`);
    const job = await getRes.json();
    assert(job.status === "READY" && Number.isFinite(job.progress_pct), "job state expected READY");
    assert(typeof job.selected_tier === "string", "selected_tier should be present");
    assert(typeof job.last_transition_at === "string", "last_transition_at should be present");
    notes.push("PASS GET /jobs/:id READY state transition");

    const eventsRes = await fetch(`${baseUrl}/jobs/${created.job_id}/events`);
    assert(eventsRes.status === 200, `events status expected 200 got ${eventsRes.status}`);
    const eventsJson = await eventsRes.json();
    const states = (eventsJson.events || []).map((e) => e.state);
    assert(states[0] === "PENDING", "events first state should be PENDING");
    assert(states.includes("PROCESSING"), "events should include PROCESSING");
    assert(states[states.length - 1] === "READY", "events last state should be READY");
    notes.push("PASS /jobs/:id/events success transition trace");

    const outputRes = await fetch(`${baseUrl}/jobs/${created.job_id}/output`);
    assert(outputRes.status === 200, `output status expected 200 got ${outputRes.status}`);
    const ct = outputRes.headers.get("content-type") || "";
    assert(ct.includes("application/pdf"), "output content-type should be application/pdf");
    notes.push("PASS GET /jobs/:id/output contract");

    // Admission budget block
    const blockedRes = await postJob({ targetLang: "tr", packageName: "free", remainingUnits: 0 });
    assert(blockedRes.status === 409, `blocked status expected 409 got ${blockedRes.status}`);
    const blocked = await blockedRes.json();
    assert(blocked.error === "COST_GUARD_BLOCK", `blocked error expected COST_GUARD_BLOCK got ${blocked.error}`);
    notes.push("PASS COST_GUARD_BLOCK admission");

    // Baseline hardening: invalid package should fail fast
    const invalidPkgRes = await postJob({ targetLang: "tr", packageName: "enterprise", remainingUnits: 100 });
    assert(invalidPkgRes.status === 400, `invalid package expected 400 got ${invalidPkgRes.status}`);
    notes.push("PASS invalid package rejected");

    // Provider fallback: one tier fail -> next tier success
    const createFallbackRes = await postJob({ targetLang: "tr", packageName: "pro", remainingUnits: 9999 });
    assert(createFallbackRes.status === 201, `fallback create expected 201 got ${createFallbackRes.status}`);
    const fallbackJob = await createFallbackRes.json();

    const fallbackRunRes = await fetch(
      `${baseUrl}/jobs/${fallbackJob.job_id}/run?simulate_fail_tiers=standard`,
      { method: "POST" }
    );
    assert(fallbackRunRes.status === 202, `fallback run expected 202 got ${fallbackRunRes.status}`);

    const fallbackGetRes = await fetch(`${baseUrl}/jobs/${fallbackJob.job_id}`);
    assert(fallbackGetRes.status === 200, "fallback get expected 200");
    const fallbackGet = await fallbackGetRes.json();
    assert(fallbackGet.status === "READY", "fallback job should end READY");
    assert((fallbackGet.billing?.charged_units || 0) >= 3, "fallback should charge next tier units");
    notes.push("PASS provider fallback one-tier-fail then success");

    // Provider fallback: all tiers fail -> FAILED + normalized error_code
    const createFailRes = await postJob({ targetLang: "tr", packageName: "pro", remainingUnits: 9999 });
    assert(createFailRes.status === 201, `fail create expected 201 got ${createFailRes.status}`);
    const failJob = await createFailRes.json();

    const failRunRes = await fetch(
      `${baseUrl}/jobs/${failJob.job_id}/run?simulate_fail_tiers=standard,premium,economy`,
      { method: "POST" }
    );
    assert(failRunRes.status === 409, `all-fail run expected 409 got ${failRunRes.status}`);
    const failRun = await failRunRes.json();
    assert(failRun.error === "PROVIDER_TIMEOUT", `all-fail error expected PROVIDER_TIMEOUT got ${failRun.error}`);

    const failGetRes = await fetch(`${baseUrl}/jobs/${failJob.job_id}`);
    assert(failGetRes.status === 200, "fail get expected 200");
    const failGet = await failGetRes.json();
    assert(failGet.status === "FAILED", `failed state expected FAILED got ${failGet.status}`);
    assert(
      failGet.error_code === "PROVIDER_TIMEOUT",
      `failed error_code expected PROVIDER_TIMEOUT got ${failGet.error_code}`
    );
    notes.push("PASS provider all-tier-fail -> FAILED + normalized error");

    const failEventsRes = await fetch(`${baseUrl}/jobs/${failJob.job_id}/events`);
    assert(failEventsRes.status === 200, `failed events status expected 200 got ${failEventsRes.status}`);
    const failEvents = await failEventsRes.json();
    const failStates = (failEvents.events || []).map((e) => e.state);
    assert(failStates.includes("PROCESSING"), "failed events should include PROCESSING");
    assert(failStates[failStates.length - 1] === "FAILED", "failed events last state should be FAILED");
    notes.push("PASS /jobs/:id/events failure transition trace");

    const failOutputRes = await fetch(`${baseUrl}/jobs/${failJob.job_id}/output`);
    assert(failOutputRes.status === 409, `failed output expected 409 got ${failOutputRes.status}`);
    notes.push("PASS failed output contract job_not_ready");

    // Async queue simulation toggle: PROCESSING visible before READY
    const asyncCreateRes = await postJob({ targetLang: "tr", packageName: "free", remainingUnits: 9999 });
    assert(asyncCreateRes.status === 201, `async create expected 201 got ${asyncCreateRes.status}`);
    const asyncJob = await asyncCreateRes.json();
    const asyncRunRes = await fetch(
      `${baseUrl}/jobs/${asyncJob.job_id}/run?async=1&worker_delay_ms=250`,
      { method: "POST" }
    );
    assert(asyncRunRes.status === 202, `async run expected 202 got ${asyncRunRes.status}`);
    const midRes = await fetch(`${baseUrl}/jobs/${asyncJob.job_id}`);
    const midJob = await midRes.json();
    assert(midJob.status === "PROCESSING", `mid state expected PROCESSING got ${midJob.status}`);
    await wait(700);
    const doneRes = await fetch(`${baseUrl}/jobs/${asyncJob.job_id}`);
    const doneJob = await doneRes.json();
    assert(doneJob.status === "READY", `final async state expected READY got ${doneJob.status}`);
    notes.push("PASS async worker-delay simulation for polling");

    // Async failure simulation: PROCESSING visible first, then FAILED with normalized error
    const asyncFailCreateRes = await postJob({ targetLang: "tr", packageName: "pro", remainingUnits: 9999 });
    assert(asyncFailCreateRes.status === 201, `async fail create expected 201 got ${asyncFailCreateRes.status}`);
    const asyncFailJob = await asyncFailCreateRes.json();
    const asyncFailRunRes = await fetch(
      `${baseUrl}/jobs/${asyncFailJob.job_id}/run?async=1&worker_delay_ms=200&simulate_fail_tiers=standard,premium,economy`,
      { method: "POST" }
    );
    assert(asyncFailRunRes.status === 202, `async fail run expected 202 got ${asyncFailRunRes.status}`);
    const asyncMidRes = await fetch(`${baseUrl}/jobs/${asyncFailJob.job_id}`);
    const asyncMidJob = await asyncMidRes.json();
    assert(asyncMidJob.status === "PROCESSING", `async fail mid expected PROCESSING got ${asyncMidJob.status}`);
    await wait(700);
    const asyncFailDoneRes = await fetch(`${baseUrl}/jobs/${asyncFailJob.job_id}`);
    const asyncFailDone = await asyncFailDoneRes.json();
    assert(asyncFailDone.status === "FAILED", `async fail final expected FAILED got ${asyncFailDone.status}`);
    assert(
      asyncFailDone.error_code === "PROVIDER_TIMEOUT",
      `async fail error_code expected PROVIDER_TIMEOUT got ${asyncFailDone.error_code}`
    );
    const asyncFailEventsRes = await fetch(`${baseUrl}/jobs/${asyncFailJob.job_id}/events`);
    const asyncFailEvents = await asyncFailEventsRes.json();
    const asyncFailStates = (asyncFailEvents.events || []).map((e) => e.state);
    assert(asyncFailStates.includes("PROCESSING"), "async fail events should include PROCESSING");
    assert(asyncFailStates[asyncFailStates.length - 1] === "FAILED", "async fail events last state should be FAILED");
    notes.push("PASS async failure simulation for polling + events");

    // Error normalization: known provider code should be preserved
    const knownErrCreateRes = await postJob({ targetLang: "tr", packageName: "pro", remainingUnits: 9999 });
    assert(knownErrCreateRes.status === 201, `known error create expected 201 got ${knownErrCreateRes.status}`);
    const knownErrJob = await knownErrCreateRes.json();
    const knownErrRunRes = await fetch(
      `${baseUrl}/jobs/${knownErrJob.job_id}/run?simulate_fail_tiers=standard,premium,economy&simulate_fail_code=PROVIDER_RATE_LIMIT`,
      { method: "POST" }
    );
    assert(knownErrRunRes.status === 409, `known error run expected 409 got ${knownErrRunRes.status}`);
    const knownErrRun = await knownErrRunRes.json();
    assert(
      knownErrRun.error === "PROVIDER_RATE_LIMIT",
      `known error should preserve PROVIDER_RATE_LIMIT got ${knownErrRun.error}`
    );
    notes.push("PASS known provider error code preserved");

    // Error normalization: unknown provider error should map to PROVIDER_UPSTREAM_5XX
    const unknownErrCreateRes = await postJob({ targetLang: "tr", packageName: "pro", remainingUnits: 9999 });
    assert(unknownErrCreateRes.status === 201, `unknown error create expected 201 got ${unknownErrCreateRes.status}`);
    const unknownErrJob = await unknownErrCreateRes.json();
    const unknownErrRunRes = await fetch(
      `${baseUrl}/jobs/${unknownErrJob.job_id}/run?simulate_fail_tiers=standard,premium,economy&simulate_fail_code=RANDOM_PROVIDER_ERROR`,
      { method: "POST" }
    );
    assert(unknownErrRunRes.status === 409, `unknown error run expected 409 got ${unknownErrRunRes.status}`);
    const unknownErrRun = await unknownErrRunRes.json();
    assert(
      unknownErrRun.error === "PROVIDER_UPSTREAM_5XX",
      `unknown error should normalize to PROVIDER_UPSTREAM_5XX got ${unknownErrRun.error}`
    );
    notes.push("PASS unknown provider error normalized to PROVIDER_UPSTREAM_5XX");

    // Retry policy simulation: same tier one retry should recover without fallback
    const retryCreateRes = await postJob({ targetLang: "tr", packageName: "pro", remainingUnits: 9999 });
    assert(retryCreateRes.status === 201, `retry create expected 201 got ${retryCreateRes.status}`);
    const retryJob = await retryCreateRes.json();
    const retryRunRes = await fetch(
      `${baseUrl}/jobs/${retryJob.job_id}/run?simulate_retry_once_tiers=standard`,
      { method: "POST" }
    );
    assert(retryRunRes.status === 202, `retry run expected 202 got ${retryRunRes.status}`);
    const retryGet = await getJob(retryJob.job_id);
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

    const q1RunRes = await fetch(`${baseUrl}/jobs/${q1.job_id}/run?async=1&worker_delay_ms=500`, { method: "POST" });
    assert(q1RunRes.status === 202, `q1 async run expected 202 got ${q1RunRes.status}`);
    const q2RunRes = await fetch(`${baseUrl}/jobs/${q2.job_id}/run?async=1`, { method: "POST" });
    assert(q2RunRes.status === 202, `q2 async run expected 202 got ${q2RunRes.status}`);

    await wait(150);
    const q2Mid = await getJob(q2.job_id);
    assert(q2Mid.status === "PROCESSING", `q2 mid status expected PROCESSING got ${q2Mid.status}`);
    assert(!q2Mid.selected_tier, "q2 should not be selected before worker executes");

    const q1Ready = await waitForJobStatus(q1.job_id, "READY");
    const q2Ready = await waitForJobStatus(q2.job_id, "READY");
    assert(
      Date.parse(q2Ready.last_transition_at) >= Date.parse(q1Ready.last_transition_at),
      "q2 must not transition to READY before q1 in single-worker queue"
    );
    notes.push("PASS single-worker queue ordering preserved for async jobs");

    const notFoundRes = await fetch(`${baseUrl}/jobs/nope/run`, { method: "POST" });
    assert(notFoundRes.status === 404, `run missing job expected 404 got ${notFoundRes.status}`);
    notes.push("PASS job_not_found contract");

    const badRunCreateRes = await postJob({ targetLang: "tr", packageName: "free", remainingUnits: 9999 });
    assert(badRunCreateRes.status === 201, `bad run create expected 201 got ${badRunCreateRes.status}`);
    const badRunJob = await badRunCreateRes.json();
    const badRunRes = await fetch(`${baseUrl}/jobs/${badRunJob.job_id}/run?simulate_fail_tier=gold`, {
      method: "POST"
    });
    assert(badRunRes.status === 400, `invalid run tier expected 400 got ${badRunRes.status}`);
    notes.push("PASS invalid run tier rejected");

    const eventsMissingRes = await fetch(`${baseUrl}/jobs/nope/events`);
    assert(eventsMissingRes.status === 404, `events missing job expected 404 got ${eventsMissingRes.status}`);
    notes.push("PASS events job_not_found contract");

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
