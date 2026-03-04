import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logPath = path.resolve(__dirname, "../audit/audit-log.md");

function fail(msg) {
  console.log("FAIL");
  console.log("AUDIT SUMMARY:");
  console.log(`- FAIL ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(logPath)) {
  fail("audit log not found");
}

const lines = fs.readFileSync(logPath, "utf8").split(/\r?\n/);
const runs = lines.filter((l) => l.startsWith("- ") && l.includes("| DRY_RUN="));
if (runs.length === 0) {
  fail("no audit runs found");
}

const passRuns = runs.filter((r) => r.includes("| PASS")).length;
const failRuns = runs.filter((r) => r.includes("| FAIL")).length;

console.log("PASS");
console.log("AUDIT SUMMARY:");
console.log(`- PASS total audit runs=${runs.length}`);
console.log(`- PASS pass runs=${passRuns}`);
console.log(`- PASS fail runs=${failRuns}`);
console.log("- PASS recent runs:");
for (const run of runs.slice(-5)) {
  console.log(`  ${run}`);
}
