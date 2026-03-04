import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const checklist = fs.readFileSync(path.join(root, "research/release_hardening.md"), "utf8");
const risks = fs.readFileSync(path.join(root, "research/risk_register.md"), "utf8");

const reqChecklist = [
  "test:scaffold",
  "test:flow",
  "test:audit-compact",
  "test:ios-contract",
  "test:ios-migration",
  "test:benchmark-mode"
];
const reqRisks = ["R1", "R2", "R3", "R4", "R5"];

const missingChecklist = reqChecklist.filter((x) => !checklist.includes(x));
const missingRisks = reqRisks.filter((x) => !risks.includes(x));

if (missingChecklist.length || missingRisks.length) {
  console.log("FAIL");
  console.log("AUDIT SUMMARY:");
  if (missingChecklist.length) console.log(`- FAIL missing checklist tokens: ${missingChecklist.join(", ")}`);
  if (missingRisks.length) console.log(`- FAIL missing risk tokens: ${missingRisks.join(", ")}`);
  process.exit(1);
}

console.log("PASS");
console.log("AUDIT SUMMARY:");
console.log("- PASS release hardening checklist tokens present");
console.log("- PASS risk register entries R1..R5 present");
