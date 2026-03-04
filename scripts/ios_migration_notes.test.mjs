import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const p = path.join(root, "research/ios_migration_notes.md");
const txt = fs.readFileSync(p, "utf8");

const required = [
  "POST /jobs",
  "POST /jobs/{id}/run",
  "GET /jobs/{id}",
  "idempotent",
  "ux_hint",
  "LAYOUT_QUALITY_GATE_BLOCK"
];

const missing = required.filter((r) => !txt.includes(r));

if (missing.length > 0) {
  console.log("FAIL");
  console.log("AUDIT SUMMARY:");
  console.log(`- FAIL missing migration tokens: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("PASS");
console.log("AUDIT SUMMARY:");
console.log("- PASS ios migration notes include current contract essentials");
