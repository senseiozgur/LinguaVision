import fs from "fs";
import path from "path";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const root = process.cwd();
const target = path.join(root, "scripts", "chat_heartbeat.ps1");
const notes = [];
let pass = true;

try {
  assert(fs.existsSync(target), "script missing");
  notes.push("PASS script exists");

  const src = fs.readFileSync(target, "utf8");
  const required = [
    "ValidateSet(\"Cevher\", \"Olgun\")",
    ".coord/heartbeats",
    "ACTION REQUEST",
    "Peer OK",
    "STATUS REQUEST",
    "$AutoLive",
    "Write-LiveLine",
    "LIVE:"
  ];

  for (const token of required) {
    const ok = src.includes(token);
    notes.push(`${ok ? "PASS" : "FAIL"} token: ${token}`);
    if (!ok) pass = false;
  }
} catch (err) {
  pass = false;
  notes.push(`FAIL exception: ${err.message}`);
}

console.log(pass ? "PASS" : "FAIL");
console.log("AUDIT SUMMARY:");
for (const n of notes) console.log(`- ${n}`);
process.exit(pass ? 0 : 1);
