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
const API_KEY = "lv-test-key";

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildPdfForm({ providerMode = "mode_a" } = {}) {
  const form = new FormData();
  form.append("target_lang", "tr");
  form.append("package", "free");
  form.append("provider_mode", providerMode);
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x0a, 0x25]);
  form.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "sample.pdf");
  return form;
}

async function withServer({ port, env }, fn) {
  const server = spawn(process.execPath, ["src/server.js"], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: String(port),
      LV_API_KEY: API_KEY,
      BILLING_PROVIDER: "stub",
      TRANSLATION_CACHE_PERSIST: "0",
      OUTPUT_CACHE_PERSIST: "0",
      LV_RATE_LIMIT_CREATE_PER_MIN: "500",
      LV_RATE_LIMIT_RUN_PER_MIN: "500",
      LV_RATE_LIMIT_GET_PER_MIN: "500",
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const rawFetch = globalThis.fetch.bind(globalThis);
  async function apiFetch(url, init = {}) {
    const headers = new Headers(init.headers || {});
    headers.set("x-api-key", API_KEY);
    return rawFetch(url, { ...init, headers });
  }

  async function waitForServerReady(timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await apiFetch(`${baseUrl}/jobs/non-existent-id`);
        if (res.status === 404) return;
      } catch {}
      await wait(200);
    }
    throw new Error("server did not become ready");
  }

  async function createJob() {
    const res = await apiFetch(`${baseUrl}/jobs`, { method: "POST", body: buildPdfForm() });
    return { res, body: await res.json() };
  }

  async function runJob(jobId, qs = "") {
    const suffix = qs ? `?${qs}` : "";
    const res = await apiFetch(`${baseUrl}/jobs/${jobId}/run${suffix}`, { method: "POST" });
    return { res, body: await res.json() };
  }

  async function getJob(jobId) {
    const res = await apiFetch(`${baseUrl}/jobs/${jobId}`);
    return res.json();
  }

  async function waitForJobStatus(jobId, expected, timeoutMs = 7000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const job = await getJob(jobId);
      if (job.status === expected) return job;
      await wait(120);
    }
    throw new Error(`job ${jobId} did not reach ${expected}`);
  }

  server.stdout.on("data", () => {});
  server.stderr.on("data", () => {});

  try {
    await waitForServerReady();
    await fn({ baseUrl, apiFetch, createJob, runJob, getJob, waitForJobStatus });
  } finally {
    if (!server.killed) server.kill("SIGTERM");
  }
}

async function main() {
  const notes = [];
  try {
    await withServer(
      {
        port: 8795,
        env: {
          LV_ENABLE_SIMULATION_FLAGS: "0",
          LV_MODE_A_ALLOW_SIMULATED_SUCCESS: "1"
        }
      },
      async (api) => {
        const created = await api.createJob();
        assert(created.res.status === 201, `create expected 201 got ${created.res.status}`);
        const run = await api.runJob(created.body.job_id, "simulate_fail_tiers=standard");
        assert(run.res.status === 403, `simulation-disabled run expected 403 got ${run.res.status}`);
        assert(run.body.error === "simulation_flags_disabled", `expected simulation_flags_disabled got ${run.body.error}`);
        const job = await api.getJob(created.body.job_id);
        assert(job.status === "PENDING", `job should remain PENDING got ${job.status}`);
        notes.push("PASS simulation flags blocked by default");
      }
    );

    await withServer(
      {
        port: 8796,
        env: {
          LV_ENABLE_SIMULATION_FLAGS: "1",
          LV_MODE_A_ALLOW_SIMULATED_SUCCESS: "1"
        }
      },
      async (api) => {
        const created = await api.createJob();
        assert(created.res.status === 201, `create expected 201 got ${created.res.status}`);
        const run = await api.runJob(created.body.job_id, "simulate_fail_tiers=economy,standard&simulate_fail_code=PROVIDER_TIMEOUT");
        assert(run.res.status === 202, `simulation-enabled run expected 202 got ${run.res.status}`);
        const finalJob = await api.waitForJobStatus(created.body.job_id, "FAILED");
        assert(finalJob.error_code === "PROVIDER_TIMEOUT", `expected PROVIDER_TIMEOUT got ${finalJob.error_code}`);
        notes.push("PASS simulation flags allowed when explicitly enabled");
      }
    );

    await withServer(
      {
        port: 8797,
        env: {
          LV_ENABLE_SIMULATION_FLAGS: "0",
          LV_MODE_A_ALLOW_SIMULATED_SUCCESS: "1",
          BILLING_STUB_DAILY_CAP_EXCEEDED: "1"
        }
      },
      async (api) => {
        const created = await api.createJob();
        assert(created.res.status === 201, `create expected 201 got ${created.res.status}`);
        const run = await api.runJob(created.body.job_id);
        assert(run.res.status === 202, `run expected 202 got ${run.res.status}`);
        const finalJob = await api.waitForJobStatus(created.body.job_id, "FAILED");
        assert(
          finalJob.error_code === "BILLING_DAILY_CAP_EXCEEDED",
          `expected BILLING_DAILY_CAP_EXCEEDED got ${finalJob.error_code}`
        );
        assert(finalJob.billing?.charged === false, "daily cap denial must not charge");
        assert(finalJob.billing?.charge_state === "NOT_CHARGED", `expected NOT_CHARGED got ${finalJob.billing?.charge_state}`);
        const outRes = await api.apiFetch(`${api.baseUrl}/jobs/${created.body.job_id}/output`);
        assert(outRes.status === 409, `rejected run should not expose output artifact, got ${outRes.status}`);
        notes.push("PASS daily cap denial fails job and creates no charged state");
      }
    );

    console.log("PASS");
    for (const n of notes) console.log(`- ${n}`);
    process.exitCode = 0;
  } catch (err) {
    console.log("FAIL");
    console.log(`- ${err.message}`);
    process.exitCode = 1;
  }
}

await main();
