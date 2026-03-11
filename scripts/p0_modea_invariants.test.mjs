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

async function makeApi(port, init = {}) {
  const baseUrl = `http://127.0.0.1:${port}`;
  const rawFetch = globalThis.fetch.bind(globalThis);
  async function apiFetch(url, reqInit = {}) {
    const headers = new Headers(reqInit.headers || {});
    headers.set("x-api-key", API_KEY);
    return rawFetch(url, { ...reqInit, headers });
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
    throw new Error("server not ready");
  }

  function makePdfBlob() {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x0a, 0x25]);
    return new Blob([pdfBytes], { type: "application/pdf" });
  }

  async function createJob({ providerMode = "mode_a" } = {}) {
    const form = new FormData();
    form.append("target_lang", "tr");
    form.append("package", "free");
    form.append("provider_mode", providerMode);
    form.append("file", makePdfBlob(), "sample.pdf");
    return apiFetch(`${baseUrl}/jobs`, { method: "POST", body: form });
  }

  async function runJob(jobId) {
    return apiFetch(`${baseUrl}/jobs/${jobId}/run`, { method: "POST" });
  }

  async function getJob(jobId) {
    const res = await apiFetch(`${baseUrl}/jobs/${jobId}`);
    return res.json();
  }

  async function waitForJobStatus(jobId, expected, timeoutMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const job = await getJob(jobId);
      if (job.status === expected) return job;
      await wait(120);
    }
    throw new Error(`job ${jobId} did not reach ${expected}`);
  }

  return {
    baseUrl,
    apiFetch,
    waitForServerReady,
    createJob,
    runJob,
    getJob,
    waitForJobStatus,
    ...init
  };
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

  server.stdout.on("data", () => {});
  server.stderr.on("data", () => {});

  try {
    const api = await makeApi(port);
    await api.waitForServerReady();
    await fn(api);
  } finally {
    if (!server.killed) server.kill("SIGTERM");
  }
}

async function main() {
  const notes = [];
  try {
    await withServer(
      {
        port: 8793,
        env: {
          LV_MODE_A_ALLOW_SIMULATED_SUCCESS: "0",
          DEEPL_API_KEY: "",
          GOOGLE_PROJECT_ID: "",
          GOOGLE_APPLICATION_CREDENTIALS: "",
          GOOGLE_SERVICE_ACCOUNT_JSON: ""
        }
      },
      async (api) => {
        const createRes = await api.createJob({ providerMode: "mode_a" });
        assert(createRes.status === 201, `create expected 201 got ${createRes.status}`);
        const created = await createRes.json();

        const runRes = await api.runJob(created.job_id);
        assert(runRes.status === 202, `run expected 202 got ${runRes.status}`);

        const finalJob = await api.waitForJobStatus(created.job_id, "FAILED", 7000);
        assert(finalJob.error_code === "PROVIDER_AUTH_ERROR", `expected PROVIDER_AUTH_ERROR got ${finalJob.error_code}`);
        assert(finalJob.billing?.charged === true, "missing-creds path should reflect attempted charge");
        assert(finalJob.billing?.refunded === true, "missing-creds path should be refunded");
        assert(finalJob.billing?.charge_state === "REFUNDED", `expected REFUNDED got ${finalJob.billing?.charge_state}`);

        const outRes = await api.apiFetch(`${api.baseUrl}/jobs/${created.job_id}/output`);
        assert(outRes.status === 409, `failed output should be 409 got ${outRes.status}`);
        notes.push("PASS MODE_A missing creds fails and does not emit READY artifact");
      }
    );

    await withServer(
      {
        port: 8794,
        env: {
          LV_MODE_A_ALLOW_SIMULATED_SUCCESS: "0",
          BILLING_STUB_FAIL_CHARGE: "1"
        }
      },
      async (api) => {
        const createRes = await api.createJob({ providerMode: "mode_a" });
        assert(createRes.status === 201, `create expected 201 got ${createRes.status}`);
        const created = await createRes.json();

        const runRes = await api.runJob(created.job_id);
        assert(runRes.status === 202, `run expected 202 got ${runRes.status}`);

        const finalJob = await api.waitForJobStatus(created.job_id, "FAILED", 7000);
        assert(finalJob.error_code === "BILLING_ERROR", `expected BILLING_ERROR got ${finalJob.error_code}`);
        assert(finalJob.billing?.charged === false, "charge failure must not mark charged");
        assert(finalJob.billing?.charge_state === "NOT_CHARGED", `charge_state expected NOT_CHARGED got ${finalJob.billing?.charge_state}`);

        const outRes = await api.apiFetch(`${api.baseUrl}/jobs/${created.job_id}/output`);
        assert(outRes.status === 409, `failed output should be 409 got ${outRes.status}`);
        notes.push("PASS charge failure reaches FAILED terminal state and does not stick PROCESSING");
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
