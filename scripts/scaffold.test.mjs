import fs from "fs";
import path from "path";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const root = process.cwd();
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

const jobsRoute = fs.readFileSync(path.join(root, "backend/src/routes/jobs.routes.js"), "utf8");
const hasGuard = jobsRoute.includes("validateAdmission") && jobsRoute.includes("INPUT_LIMIT_EXCEEDED");
notes.push(`${hasGuard ? "PASS" : "FAIL"} admission guard wiring`);
if (!hasGuard) pass = false;

console.log(pass ? "PASS" : "FAIL");
console.log("AUDIT SUMMARY:");
for (const n of notes) console.log(`- ${n}`);
process.exit(pass ? 0 : 1);
