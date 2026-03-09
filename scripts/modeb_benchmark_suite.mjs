import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { extractPdfTextBlocks } from "../backend/src/pdf/text.extractor.js";
import { chunkTextBlocks } from "../backend/src/pdf/chunker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const backendDir = path.join(repoRoot, "backend");
const pdfStatsPy = path.join(__dirname, "pdf_stats.py");
const defaultCorpus = ["ornek.pdf", "ornek_1.pdf", "ornek_2.pdf"];
const corpus = (process.env.LV_BENCH_FILES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const benchmarkCorpus = corpus.length ? corpus : defaultCorpus;

const port = Number(process.env.LV_BENCH_PORT || 8798);
const baseUrl = `http://127.0.0.1:${port}`;
const apiKey = process.env.LV_API_KEY || "lv-test-key";
const runId = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiFetch(url, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("x-api-key", apiKey);
  return fetch(url, { ...init, headers });
}

function getEventMeta(events, name) {
  const found = (events || []).find((e) => e.state === name);
  return found?.meta || null;
}

function detectFallback(blocks) {
  return (blocks || []).some((b) => String(b.text || "").includes("No extractable text found"));
}

function readBackendEnvSubset() {
  const envPath = path.join(backendDir, ".env");
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  const allow = new Set([
    "DEEPL_API_KEY",
    "GOOGLE_TRANSLATE_API_KEY",
    "GOOGLE_TRANSLATE_BASE_URL",
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "GROQ_API_KEY",
    "GROQ_MODEL"
  ]);
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const idx = t.indexOf("=");
    const key = t.slice(0, idx).trim();
    let value = t.slice(idx + 1).trim();
    if (!allow.has(key)) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value) out[key] = value;
  }
  return out;
}

function pythonStats(pdfPath) {
  const py = process.env.LV_PDF_EXTRACTOR_PYTHON || "python";
  const run = spawnSync(py, [pdfStatsPy, pdfPath], {
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" }
  });
  if (run.error) throw run.error;
  if (run.status !== 0) {
    throw new Error((run.stderr || run.stdout || "").trim() || `pdf_stats_exit_${run.status}`);
  }
  return JSON.parse(String(run.stdout || "{}"));
}

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

async function inspectCorpus() {
  const items = [];
  for (const name of benchmarkCorpus) {
    const full = path.join(backendDir, name);
    const stat = await fsp.stat(full);
    const bytes = await fsp.readFile(full);
    const blocks = extractPdfTextBlocks(bytes);
    const chunks = chunkTextBlocks(blocks);
    const pdf = pythonStats(full);
    items.push({
      file_name: name,
      file_path: full,
      file_size: stat.size,
      input_page_count: Number(pdf.page_count || 0),
      extraction_block_count: blocks.length,
      chunk_count_estimate: chunks.length,
      fallback_detected: detectFallback(blocks),
      extraction_sample: String(blocks[0]?.text || "").slice(0, 160)
    });
  }
  return items;
}

async function waitForReady(timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await apiFetch(`${baseUrl}/jobs/non-existent-id`);
      if (res.status === 404) return;
    } catch {
      // keep retrying
    }
    await wait(250);
  }
  throw new Error("api_not_ready");
}

async function createAndRunJob(fileName, bytes) {
  const form = new FormData();
  form.append("target_lang", "tr");
  form.append("package", "pro");
  form.append("provider_mode", "mode_b");
  const blob = new Blob([bytes], { type: "application/pdf" });
  form.append("file", blob, fileName);

  const createRes = await apiFetch(`${baseUrl}/jobs`, { method: "POST", body: form });
  const createJson = await createRes.json();
  if (createRes.status !== 201) {
    return {
      status: "FAILED",
      create_status: createRes.status,
      create_body: createJson
    };
  }

  const jobId = createJson.job_id;
  const runRes = await apiFetch(`${baseUrl}/jobs/${jobId}/run`, { method: "POST" });
  const runJson = await runRes.json().catch(() => ({}));
  if (runRes.status !== 202) {
    return {
      job_id: jobId,
      status: "FAILED",
      run_status: runRes.status,
      run_body: runJson
    };
  }

  const started = Date.now();
  let current = null;
  for (;;) {
    const poll = await apiFetch(`${baseUrl}/jobs/${jobId}`);
    const pollJson = await poll.json();
    if (poll.status !== 200) {
      return {
        job_id: jobId,
        status: "FAILED",
        poll_status: poll.status,
        poll_body: pollJson
      };
    }
    current = pollJson;
    if (current.status === "READY" || current.status === "FAILED") break;
    if (Date.now() - started > 10 * 60 * 1000) {
      return {
        job_id: jobId,
        status: "FAILED",
        error: "timeout_waiting_terminal"
      };
    }
    await wait(1000);
  }

  const eventsRes = await apiFetch(`${baseUrl}/jobs/${jobId}/events`);
  const eventsJson = eventsRes.status === 200 ? await eventsRes.json() : { events: [] };

  return {
    job_id: jobId,
    final: current,
    events: eventsJson.events || [],
    duration_ms: Date.now() - started
  };
}

function evaluateGate(result, baselineByFile) {
  const reasons = [];
  if (result.final_status !== "READY") {
    reasons.push("job_not_ready");
    return { gate: "FAIL", reasons };
  }
  if (result.fallback_detected) {
    reasons.push("fallback_detected");
    return { gate: "FAIL", reasons };
  }
  if (result.overflow_flag) reasons.push("overflow_flag_true");

  const baseline = baselineByFile?.[result.file_name];
  if (baseline) {
    const tolerance = 3;
    if (result.dense_over90 > Number(baseline.dense_over90 || 0) + tolerance) {
      reasons.push("dense_over90_regression");
    }
    if (result.paragraph_count < Number(baseline.paragraph_count || 0) * 0.75) {
      reasons.push("paragraph_count_collapse");
    }
  }

  if (!reasons.length) return { gate: "PASS", reasons };
  if (reasons.includes("overflow_flag_true")) return { gate: "FAIL", reasons };
  return { gate: "WARN", reasons };
}

async function main() {
  const benchRoot = path.join(backendDir, "benchmark_suite");
  const outputsRoot = path.join(benchRoot, "outputs");
  const reportsRoot = path.join(benchRoot, "reports");
  const baselineOutputs = path.join(benchRoot, "baseline_outputs");
  const runOutputDir = path.join(outputsRoot, runId);
  const runReportDir = path.join(reportsRoot, runId);
  await ensureDir(benchRoot);
  await ensureDir(outputsRoot);
  await ensureDir(reportsRoot);
  await ensureDir(baselineOutputs);
  await ensureDir(runOutputDir);
  await ensureDir(runReportDir);

  const corpusInfo = await inspectCorpus();
  const corpusByName = Object.fromEntries(corpusInfo.map((x) => [x.file_name, x]));

  const baselinePath = path.join(reportsRoot, "baseline_metrics.json");
  let previousBaseline = null;
  if (fs.existsSync(baselinePath)) {
    previousBaseline = JSON.parse(await fsp.readFile(baselinePath, "utf8"));
    const backup = path.join(reportsRoot, `baseline_metrics.${runId}.bak.json`);
    await fsp.writeFile(backup, JSON.stringify(previousBaseline, null, 2), "utf8");
  }
  const baselineByFile = Object.fromEntries((previousBaseline?.files || []).map((x) => [x.file_name, x]));
  const envSubset = readBackendEnvSubset();
  const effectiveOrder = process.env.LV_MODE_B_PROVIDER_ORDER || "deepl_text,google_text";

  const server = spawn(process.execPath, ["src/server.js"], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: String(port),
      LV_API_KEY: apiKey,
      LV_MODE_B_PROVIDER_ORDER: effectiveOrder,
      BILLING_PROVIDER: process.env.BILLING_PROVIDER || "stub",
      OUTPUT_CACHE_PERSIST: "0",
      OUTPUT_CACHE_MAX: "1",
      TRANSLATION_CACHE_PERSIST: "0",
      DISABLE_TRANSLATION_CACHE: "1",
      LV_STORAGE_PROVIDER: process.env.LV_STORAGE_PROVIDER || "local",
      LV_DISABLE_EMBEDDED_WORKER: "0",
      DEEPL_API_KEY: process.env.DEEPL_API_KEY || envSubset.DEEPL_API_KEY || "",
      GOOGLE_TRANSLATE_API_KEY: process.env.GOOGLE_TRANSLATE_API_KEY || envSubset.GOOGLE_TRANSLATE_API_KEY || "",
      GOOGLE_TRANSLATE_BASE_URL: process.env.GOOGLE_TRANSLATE_BASE_URL || envSubset.GOOGLE_TRANSLATE_BASE_URL || "",
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || envSubset.OPENAI_API_KEY || "",
      OPENAI_MODEL: process.env.OPENAI_MODEL || envSubset.OPENAI_MODEL || "",
      GROQ_API_KEY: process.env.GROQ_API_KEY || envSubset.GROQ_API_KEY || "",
      GROQ_MODEL: process.env.GROQ_MODEL || envSubset.GROQ_MODEL || ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const serverLogPath = path.join(runReportDir, "api.log");
  const serverErrPath = path.join(runReportDir, "api.err.log");
  const logOut = fs.createWriteStream(serverLogPath);
  const logErr = fs.createWriteStream(serverErrPath);
  server.stdout.pipe(logOut);
  server.stderr.pipe(logErr);

  try {
    await waitForReady();

    const files = [];
    for (const info of corpusInfo) {
      const bytes = await fsp.readFile(info.file_path);
      const run = await createAndRunJob(info.file_name, bytes);
      const extractionMeta = getEventMeta(run.events, "TEXT_EXTRACTION_DONE") || {};
      const chunkMeta = getEventMeta(run.events, "TEXT_CHUNKING_DONE") || {};
      const layoutMeta = getEventMeta(run.events, "MODE_B_LAYOUT_DONE") || {};
      const result = {
        file_name: info.file_name,
        file_size: info.file_size,
        input_page_count: info.input_page_count,
        extracted_block_count: Number(extractionMeta.block_count || info.extraction_block_count || 0),
        extracted_chunk_count: Number(chunkMeta.chunk_count || info.chunk_count_estimate || 0),
        fallback_detected: Boolean(info.fallback_detected),
        final_status: run.final?.status || run.status || "FAILED",
        final_error_code: run.final?.error_code || run.error || null,
        provider_used: run.final?.provider_used || null,
        output_file_size: 0,
        output_page_count: 0,
        output_text_length: 0,
        line_count: 0,
        avg_line_len: 0,
        dense_over90: 0,
        dense_over100: 0,
        paragraph_count: 0,
        avg_paragraph_len: 0,
        overflow_flag: Boolean(layoutMeta.overflow_flag ?? run.final?.layout_metrics?.overflow_flag ?? false),
        headings_detected: 0,
        duration_ms: Number(run.duration_ms || 0),
        translation_cache_hit: Boolean(run.final?.translation_cache_hit),
        job_id: run.job_id || null,
        events: (run.events || []).map((e) => e.state),
        llm_failed_meta: getEventMeta(run.events, "LLM_TRANSLATION_FAILED")
      };

      if (result.final_status === "READY" && run.job_id) {
        const outRes = await apiFetch(`${baseUrl}/jobs/${run.job_id}/output`);
        if (outRes.status === 200) {
          const arr = await outRes.arrayBuffer();
          const buf = Buffer.from(arr);
          const outName = `${path.parse(info.file_name).name}-${runId}.pdf`;
          const outPath = path.join(runOutputDir, outName);
          const baselineOutPath = path.join(baselineOutputs, outName);
          await fsp.writeFile(outPath, buf);
          await fsp.writeFile(baselineOutPath, buf);
          const outStats = pythonStats(outPath);
          result.output_file_size = buf.length;
          result.output_page_count = Number(outStats.page_count || 0);
          result.output_text_length = Number(outStats.text_length || 0);
          result.line_count = Number(outStats.line_count || 0);
          result.avg_line_len = Number(outStats.avg_line_len || 0);
          result.dense_over90 = Number(outStats.dense_over90 || 0);
          result.dense_over100 = Number(outStats.dense_over100 || 0);
          result.paragraph_count = Number(outStats.paragraph_count || 0);
          result.avg_paragraph_len = Number(outStats.avg_paragraph_len || 0);
          result.headings_detected = Number(outStats.headings_detected || 0);
          result.output_path = outPath;
          result.output_sample = String(outStats.sample_text || "").slice(0, 200);
        }
      }

      const gate = evaluateGate(result, baselineByFile);
      result.gate_status = gate.gate;
      result.gate_reasons = gate.reasons;
      files.push(result);
      const perFileReport = path.join(runReportDir, `${path.parse(info.file_name).name}.metrics.json`);
      await fsp.writeFile(perFileReport, JSON.stringify(result, null, 2), "utf8");
    }

    const summary = {
      run_id: runId,
      generated_at: new Date().toISOString(),
      provider_mode: "mode_b",
      preferred_provider_order: effectiveOrder,
      files,
      totals: {
        pass: files.filter((x) => x.gate_status === "PASS").length,
        warn: files.filter((x) => x.gate_status === "WARN").length,
        fail: files.filter((x) => x.gate_status === "FAIL").length
      },
      corpus: corpusInfo
    };

    const runReport = path.join(runReportDir, "benchmark_report.json");
    await fsp.writeFile(runReport, JSON.stringify(summary, null, 2), "utf8");
    await fsp.writeFile(path.join(reportsRoot, "baseline_metrics.json"), JSON.stringify(summary, null, 2), "utf8");

    console.log("BENCHMARK_RUN_ID", runId);
    console.log("BENCHMARK_REPORT", runReport);
    for (const f of files) {
      console.log(
        `${f.file_name} status=${f.final_status} gate=${f.gate_status} provider=${f.provider_used || "n/a"} pages=${
          f.output_page_count
        } dense90=${f.dense_over90} overflow=${f.overflow_flag}`
      );
    }
  } finally {
    server.kill("SIGTERM");
    await wait(500);
    if (!server.killed) {
      server.kill("SIGKILL");
    }
  }
}

await main();
