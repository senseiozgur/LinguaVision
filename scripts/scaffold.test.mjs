import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { estimateStepUnits, validateAdmission, validateRuntimeStep } from "../backend/src/routing/cost.guard.js";

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
  "backend/src/storage/local.storage.js",
  "backend/src/routing/cost.guard.js"
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

const jobsRoute = fs.readFileSync(path.join(root, "backend/src/routes/jobs.routes.js"), "utf8");
const hasAdmissionGuard =
  jobsRoute.includes("validateAdmission") &&
  jobsRoute.includes("COST_GUARD_BLOCK") &&
  jobsRoute.includes("INPUT_LIMIT_EXCEEDED");
const hasRuntimeGuard =
  jobsRoute.includes("validateRuntimeStep") &&
  jobsRoute.includes("runtimeGuard.error");

notes.push(`${hasAdmissionGuard ? "PASS" : "FAIL"} admission guard wiring`);
notes.push(`${hasRuntimeGuard ? "PASS" : "FAIL"} runtime guard wiring`);
if (!hasAdmissionGuard || !hasRuntimeGuard) pass = false;

console.log(pass ? "PASS" : "FAIL");
console.log("AUDIT SUMMARY:");
for (const n of notes) console.log(`- ${n}`);
process.exit(pass ? 0 : 1);
