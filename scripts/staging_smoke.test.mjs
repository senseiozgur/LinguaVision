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
const port = 8793;
const baseUrl = `http://127.0.0.1:${port}`;
const API_KEY = "lv-test-key";
const ALT_API_KEY = "lv-test-key-alt";
const notes = [];
let server;
const rawFetch = globalThis.fetch.bind(globalThis);

async function apiFetch(url, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("x-api-key", API_KEY);
  return rawFetch(url, { ...init, headers });
}

async function altFetch(url, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("x-api-key", ALT_API_KEY);
  return rawFetch(url, { ...init, headers });
}

function makePdf(size) {
  const pdf = new Uint8Array(size);
  pdf[0] = 0x25;
  pdf[1] = 0x50;
  pdf[2] = 0x44;
  pdf[3] = 0x46;
  pdf[4] = 0x0a;
  pdf[5] = 0x25;
  return new Blob([pdf], { type: "application/pdf" });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitReady(timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await apiFetch(`${baseUrl}/jobs/nope`);
      if (r.status === 404) return;
    } catch {}
    await sleep(200);
  }
  throw new Error("server_not_ready");
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
        LV_API_KEY: `${API_KEY},${ALT_API_KEY}`,
        LV_MAX_UPLOAD_BYTES: "1024",
        LV_RATE_LIMIT_CREATE_PER_MIN: "30",
        LV_RATE_LIMIT_RUN_PER_MIN: "30",
        LV_RATE_LIMIT_GET_PER_MIN: "8"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    await waitReady();
    notes.push("PASS backend server ready");

    const unauthorizedRes = await rawFetch(`${baseUrl}/jobs/nope`);
    assert(unauthorizedRes.status === 401, `missing key expected 401 got ${unauthorizedRes.status}`);
    notes.push("PASS missing api key blocked");

    const form = new FormData();
    form.append("target_lang", "tr");
    form.append("package", "free");
    form.append("file", makePdf(64), "smoke.pdf");

    const createRes = await apiFetch(`${baseUrl}/jobs`, { method: "POST", body: form });
    assert(createRes.status === 201, `create expected 201 got ${createRes.status}`);
    const created = await createRes.json();
    assert(created.job_id && created.status === "PENDING", "create payload invalid");
    notes.push("PASS create contract");

    const crossTenantRes = await altFetch(`${baseUrl}/jobs/${created.job_id}`);
    assert(crossTenantRes.status === 404, `owner mismatch expected 404 got ${crossTenantRes.status}`);
    notes.push("PASS tenant isolation owner mismatch hidden as 404");

    const runRes = await apiFetch(`${baseUrl}/jobs/${created.job_id}/run`, { method: "POST" });
    assert(runRes.status === 202, `run expected 202 got ${runRes.status}`);
    const runJson = await runRes.json();
    assert(runJson.accepted === true, "run payload accepted missing");
    notes.push("PASS run contract");

    const getRes = await apiFetch(`${baseUrl}/jobs/${created.job_id}`);
    assert(getRes.status === 200, `get expected 200 got ${getRes.status}`);
    const job = await getRes.json();
    assert(job.status === "READY", `job expected READY got ${job.status}`);
    assert(typeof job.selected_tier === "string", "selected_tier missing");
    assert(typeof job.layout_metrics?.anchor_count === "number", "layout_metrics missing");
    notes.push("PASS poll ready contract");

    const outputRes = await apiFetch(`${baseUrl}/jobs/${created.job_id}/output`);
    assert(outputRes.status === 200, `output expected 200 got ${outputRes.status}`);
    assert((outputRes.headers.get("content-type") || "").includes("application/pdf"), "output content-type invalid");
    notes.push("PASS output contract");

    const metricsRes = await apiFetch(`${baseUrl}/jobs/metrics`);
    assert(metricsRes.status === 200, `metrics expected 200 got ${metricsRes.status}`);
    const metrics = await metricsRes.json();
    assert(typeof metrics.jobs_create_total === "number", "jobs_create_total missing");
    assert(typeof metrics.jobs_run_total === "number", "jobs_run_total missing");
    assert(typeof metrics.jobs_ready_total === "number", "jobs_ready_total missing");
    assert(typeof metrics.provider_calls_total === "number", "provider_calls_total missing");
    assert(typeof metrics.provider_latency_avg_ms === "number", "provider_latency_avg_ms missing");
    assert(typeof metrics.cache_hits_total === "number", "cache_hits_total missing");
    assert(typeof metrics.cache_misses_total === "number", "cache_misses_total missing");
    notes.push("PASS metrics contract");

    let rateLimited = false;
    for (let i = 0; i < 12; i += 1) {
      const r = await apiFetch(`${baseUrl}/jobs/${created.job_id}`);
      if (r.status === 429) {
        rateLimited = true;
        break;
      }
    }
    assert(rateLimited, "expected at least one 429 on repeated GET");
    notes.push("PASS rate limiter returns 429");

    const bigForm = new FormData();
    bigForm.append("target_lang", "tr");
    bigForm.append("package", "free");
    bigForm.append("file", makePdf(2048), "big.pdf");
    const bigRes = await apiFetch(`${baseUrl}/jobs`, { method: "POST", body: bigForm });
    assert(bigRes.status === 413, `large upload expected 413 got ${bigRes.status}`);
    const bigJson = await bigRes.json();
    assert(bigJson.error === "payload_too_large", `expected payload_too_large got ${bigJson.error}`);
    notes.push("PASS upload size limit returns 413");

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
    if (server && !server.killed) server.kill("SIGTERM");
  }
}

await main();
