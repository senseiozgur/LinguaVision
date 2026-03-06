import express from "express";
import fs from "fs";
import { createJobsRouter } from "../backend/src/routes/jobs.routes.js";
import { JobStore } from "../backend/src/jobs/job.store.js";
import { LocalStorage } from "../backend/src/storage/local.storage.js";
import { createRateLimitStore } from "../backend/src/security/rate-limit.store.js";

async function makeApp() {
  const jobs = new JobStore();
  const storage = new LocalStorage("backend/storage-data");
  const deps = {
    jobs,
    storage,
    queue: null,
    providerAdapter: { getCacheMetrics: () => ({}) },
    outputCache: { metrics: () => ({}) },
    featureFlags: {},
    billingAdapter: {},
    apiKey: "test-key",
    metricsEnabled: true,
    metricsAllowPrimaryKey: false,
    metricsApiKey: "metrics-key",
    rateLimitStore: createRateLimitStore({ preferShared: false })
  };
  const app = express();
  app.use("/jobs", createJobsRouter(deps));
  const srv = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return { srv, port: srv.address().port };
}

async function call(port, method, path, { headers = {}, form } = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers,
    body: form
  });
  return { status: res.status, body: await res.text() };
}

const samplePath = "backend/storage-data/ratelimit-stage10.pdf";
fs.mkdirSync("backend/storage-data", { recursive: true });
fs.writeFileSync(samplePath, "%PDF-1.4\nBT (x) Tj ET\n%%EOF");
process.env.LV_RATE_LIMIT_CREATE_PER_MIN = "1";

const a1 = await makeApp();
const f1 = new FormData();
f1.append("file", new Blob([fs.readFileSync(samplePath)], { type: "application/pdf" }), "x.pdf");
f1.append("target_lang", "TR");
const c1 = await call(a1.port, "POST", "/jobs", { headers: { "x-api-key": "test-key" }, form: f1 });

const f2 = new FormData();
f2.append("file", new Blob([fs.readFileSync(samplePath)], { type: "application/pdf" }), "x.pdf");
f2.append("target_lang", "TR");
const c2 = await call(a1.port, "POST", "/jobs", { headers: { "x-api-key": "test-key" }, form: f2 });

const mPrimary = await call(a1.port, "GET", "/jobs/metrics", { headers: { "x-api-key": "test-key" } });
const mInternal = await call(a1.port, "GET", "/jobs/metrics", { headers: { "x-metrics-key": "metrics-key" } });
await new Promise((resolve) => a1.srv.close(resolve));

const a2 = await makeApp();
const f3 = new FormData();
f3.append("file", new Blob([fs.readFileSync(samplePath)], { type: "application/pdf" }), "x.pdf");
f3.append("target_lang", "TR");
const c3 = await call(a2.port, "POST", "/jobs", { headers: { "x-api-key": "test-key" }, form: f3 });
const m2 = await call(a2.port, "GET", "/jobs/metrics", { headers: { "x-metrics-key": "metrics-key" } });
await new Promise((resolve) => a2.srv.close(resolve));

console.log(
  JSON.stringify(
    {
      create_first: c1.status,
      create_second_same_instance: c2.status,
      metrics_primary_key: mPrimary.status,
      metrics_internal_key: mInternal.status,
      create_after_restart: c3.status,
      rate_limit_mode_after_restart: JSON.parse(m2.body).rate_limit_mode
    },
    null,
    2
  )
);
