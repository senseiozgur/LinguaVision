import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const readiness = fs.readFileSync(path.join(root, "research/production_readiness.md"), "utf8");
const handover = fs.readFileSync(path.join(root, "research/handover_pack.md"), "utf8");

const reqReadiness = [
  "READY_FOR_STAGING",
  "test:scaffold",
  "test:flow",
  "test:ios-contract",
  "DISABLE_LAYOUT_PIPELINE",
  "GO if all test gates PASS"
];

const reqHandover = [
  "Canonical Sources",
  "backend/src/routes/jobs.routes.js",
  "research/production_readiness.md",
  "test:release-hardening",
  "Single-agent mode"
];

const missingReadiness = reqReadiness.filter((x) => !readiness.includes(x));
const missingHandover = reqHandover.filter((x) => !handover.includes(x));

if (missingReadiness.length || missingHandover.length) {
  console.log("FAIL");
  console.log("AUDIT SUMMARY:");
  if (missingReadiness.length) console.log(`- FAIL missing readiness tokens: ${missingReadiness.join(", ")}`);
  if (missingHandover.length) console.log(`- FAIL missing handover tokens: ${missingHandover.join(", ")}`);
  process.exit(1);
}

console.log("PASS");
console.log("AUDIT SUMMARY:");
console.log("- PASS production readiness summary tokens present");
console.log("- PASS handover pack tokens present");
