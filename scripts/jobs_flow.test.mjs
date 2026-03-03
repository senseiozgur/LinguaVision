import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const backendDir = path.join(repoRoot, "backend");
const port = 8792;
const baseUrl = `http://127.0.0.1:${port}`;

const notes = [];
let server;

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServerReady(timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/jobs/non-existent-id`);
      if (res.status === 404) return;
    } catch {
      // keep polling
    }
    await wait(250);
  }
  throw new Error("server did not become ready");
}

async function postJob({ targetLang = "tr", packageName = "free", remainingUnits } = {}) {
  const form = new FormData();
  form.append("target_lang", targetLang);
  form.append("package", packageName);
  if (remainingUnits !== undefined) form.append("remaining_units", String(remainingUnits));
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x0a, 0x25]); // %PDF\n%
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  form.append("file", blob, "sample.pdf");
  return fetch(`${baseUrl}/jobs`, { method: "POST", body: form });
}

async function main() {
  try {
    server = spawn(process.execPath, ["src/server.js"], {
      cwd: backendDir,
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"]
    });

    server.stdout.on("data", () => {});
    server.stderr.on("data", () => {});

    await waitForServerReady();
    notes.push("PASS backend server ready");

    const createRes = await postJob({ targetLang: "tr", packageName: "free", remainingUnits: 9999 });
    assert(createRes.status === 201, `create job status expected 201 got ${createRes.status}`);
    const created = await createRes.json();
    assert(created.job_id && created.status === "PENDING", "create response shape invalid");
    notes.push("PASS POST /jobs create contract");

    const runRes = await fetch(`${baseUrl}/jobs/${created.job_id}/run`, { method: "POST" });
    assert(runRes.status === 202, `run status expected 202 got ${runRes.status}`);
    const runJson = await runRes.json();
    assert(runJson.accepted === true && runJson.job_id === created.job_id, "run response shape invalid");
    notes.push("PASS POST /jobs/:id/run contract");

    const getRes = await fetch(`${baseUrl}/jobs/${created.job_id}`);
    assert(getRes.status === 200, `get status expected 200 got ${getRes.status}`);
    const job = await getRes.json();
    assert(job.status === "READY" && Number.isFinite(job.progress_pct), "job state expected READY");
    notes.push("PASS GET /jobs/:id READY state");

    const outputRes = await fetch(`${baseUrl}/jobs/${created.job_id}/output`);
    assert(outputRes.status === 200, `output status expected 200 got ${outputRes.status}`);
    const ct = outputRes.headers.get("content-type") || "";
    assert(ct.includes("application/pdf"), "output content-type should be application/pdf");
    notes.push("PASS GET /jobs/:id/output contract");

    const blockedRes = await postJob({ targetLang: "tr", packageName: "free", remainingUnits: 0 });
    assert(blockedRes.status === 409, `blocked status expected 409 got ${blockedRes.status}`);
    const blocked = await blockedRes.json();
    assert(blocked.error === "COST_GUARD_BLOCK", `blocked error expected COST_GUARD_BLOCK got ${blocked.error}`);
    notes.push("PASS COST_GUARD_BLOCK admission");

    const notFoundRes = await fetch(`${baseUrl}/jobs/nope/run`, { method: "POST" });
    assert(notFoundRes.status === 404, `run missing job expected 404 got ${notFoundRes.status}`);
    notes.push("PASS job_not_found contract");

    console.log("PASS");
    console.log("AUDIT SUMMARY:");
    for (const n of notes) console.log(`- ${n}`);
    process.exitCode = 0;
  } catch (err) {
    console.log("FAIL");
    console.log("AUDIT SUMMARY:");
    for (const n of notes) console.log(`- ${n}`);
    console.log(`- FAIL ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (server && !server.killed) {
      server.kill("SIGTERM");
    }
  }
}

await main();
