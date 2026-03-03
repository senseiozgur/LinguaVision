import fs from "fs";
import path from "path";

const chatPath = path.join(process.cwd(), "chat", "chat.md");
if (!fs.existsSync(chatPath)) {
  console.log("FAIL");
  console.log("AUDIT SUMMARY:");
  console.log("- FAIL chat/chat.md not found");
  process.exit(1);
}

const content = fs.readFileSync(chatPath, "utf8");
const lines = content.split(/\r?\n/).filter(Boolean);

function parseTs(line) {
  const m = line.match(/TS=(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
  return m ? m[1] : null;
}

function lastLineFor(agent, marker) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.includes(`[${agent}]`) && line.includes(marker)) return line;
  }
  return null;
}

function stateFor(agent) {
  const live = lastLineFor(agent, "LIVE:");
  const waiting = lastLineFor(agent, "WAITING:");
  const brief = lastLineFor(agent, "BRIEF:");
  let task = null;
  if (live) {
    const m = live.match(/TASK=([^|]+)/);
    if (m) task = m[1].trim();
  }
  return { live, waiting, brief, task };
}

const cevher = stateFor("Cevher");
const olgun = stateFor("Olgun");

function isAwaiting(task) {
  if (!task) return false;
  return /awaiting next assignment|bekliyorum/i.test(task);
}

let recommendation = "CONTINUE_CURRENT_WORK";
if (isAwaiting(cevher.task) || isAwaiting(olgun.task)) {
  recommendation = "SELF_CLAIM_REQUIRED";
}
if (cevher.waiting && olgun.waiting) {
  recommendation = "BOTH_WAITING_SELF_CLAIM_REQUIRED";
}

console.log("PASS");
console.log("AUDIT SUMMARY:");
console.log(`- Cevher LIVE: ${cevher.live ?? "none"}`);
console.log(`- Olgun LIVE: ${olgun.live ?? "none"}`);
console.log(`- Cevher WAITING: ${cevher.waiting ?? "none"}`);
console.log(`- Olgun WAITING: ${olgun.waiting ?? "none"}`);
console.log(`- RECOMMENDATION: ${recommendation}`);
if (cevher.live) console.log(`- Cevher LIVE TS: ${parseTs(cevher.live) ?? "none"}`);
if (olgun.live) console.log(`- Olgun LIVE TS: ${parseTs(olgun.live) ?? "none"}`);
