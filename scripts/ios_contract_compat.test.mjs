import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const snapshotPath = path.join(root, "research/ios_contract_snapshot.json");
const routesPath = path.join(root, "backend/src/routes/jobs.routes.js");

const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
const routes = fs.readFileSync(routesPath, "utf8");

const notes = [];

try {
  assert(routes.includes('router.post("/"'), "create endpoint missing");
  assert(routes.includes('router.post("/:id/run"'), "run endpoint missing");
  assert(routes.includes('router.get("/:id"'), "get endpoint missing");
  assert(routes.includes('router.get("/:id/events"'), "events endpoint missing");
  assert(routes.includes('router.get("/:id/output"'), "output endpoint missing");
  assert(routes.includes('router.get("/metrics"'), "metrics endpoint missing");
  notes.push("PASS endpoint set present");

  for (const field of snapshot.endpoints.get_job.success) {
    assert(routes.includes(`${field}:`), `missing get_job field ${field}`);
  }
  notes.push("PASS get_job payload fields compatible");

  for (const field of snapshot.endpoints.get_metrics.success) {
    const hasDirect = routes.includes(field);
    const hasViaSpread =
      (field.startsWith("cache_") || field.startsWith("provider_")) && routes.includes("getCacheMetrics");
    assert(hasDirect || hasViaSpread, `missing metrics field ${field}`);
  }
  notes.push("PASS metrics payload fields compatible");

  for (const code of snapshot.endpoints.run_job.errors) {
    if (code === "LAYOUT_QUALITY_GATE_BLOCK") {
      assert(routes.includes(code), `missing run error code ${code}`);
    }
  }
  notes.push("PASS run error compatibility for strict quality gate");

  console.log("PASS");
  console.log("AUDIT SUMMARY:");
  for (const n of notes) console.log(`- ${n}`);
  process.exit(0);
} catch (err) {
  console.log("FAIL");
  console.log("AUDIT SUMMARY:");
  for (const n of notes) console.log(`- ${n}`);
  console.log(`- FAIL ${err.message}`);
  process.exit(1);
}
