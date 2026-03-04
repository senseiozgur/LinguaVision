import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const cadence = fs.readFileSync(path.join(root, "research/monitoring_cadence.md"), "utf8");
const incident = fs.readFileSync(path.join(root, "research/incident_template.md"), "utf8");

const reqCadence = [
  "Cadence Windows",
  "GET /jobs/metrics",
  "Alert Thresholds",
  "runtime_guard_block_total",
  "research/incident_template.md"
];

const reqIncident = [
  "Incident Header",
  "Impact Summary",
  "Detection and Signals",
  "feature_disable_layout_pipeline",
  "Timeline (UTC+3)",
  "Root Cause Analysis",
  "Mitigation and Recovery",
  "Action Items"
];

const missingCadence = reqCadence.filter((x) => !cadence.includes(x));
const missingIncident = reqIncident.filter((x) => !incident.includes(x));

if (missingCadence.length || missingIncident.length) {
  console.log("FAIL");
  console.log("AUDIT SUMMARY:");
  if (missingCadence.length) console.log(`- FAIL missing monitoring cadence tokens: ${missingCadence.join(", ")}`);
  if (missingIncident.length) console.log(`- FAIL missing incident template tokens: ${missingIncident.join(", ")}`);
  process.exit(1);
}

console.log("PASS");
console.log("AUDIT SUMMARY:");
console.log("- PASS monitoring cadence tokens present");
console.log("- PASS incident template tokens present");
