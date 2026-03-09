import fs from "fs/promises";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../..");
const BABELDOC_RUNNER = path.resolve(REPO_ROOT, "scripts/babeldoc_runner.py");

function normalizeEngineError(text) {
  const raw = String(text || "");
  const v = raw.toLowerCase();
  if (v.includes("timeout")) return "PROVIDER_TIMEOUT";
  if (v.includes("rate limit") || v.includes("429") || v.includes("quota")) return "PROVIDER_RATE_LIMIT";
  if (v.includes("unauthorized") || v.includes("authentication") || v.includes("api key") || v.includes("forbidden")) {
    return "PROVIDER_AUTH_ERROR";
  }
  return "PROVIDER_UPSTREAM_ERROR";
}

function runPython({ pythonCmd, args, env, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(pythonCmd, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code: Number(code || 0),
        stdout,
        stderr,
        timedOut
      });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        code: -1,
        stdout,
        stderr: `${stderr}\n${String(err?.message || err)}`,
        timedOut
      });
    });
  });
}

function buildPythonPath(existing = "") {
  const babeldocPath = path.resolve(REPO_ROOT, "_refs", "BabelDOC");
  const sep = process.platform === "win32" ? ";" : ":";
  if (!existing) return babeldocPath;
  return `${babeldocPath}${sep}${existing}`;
}

export function createBabelDocEngine() {
  return {
    async translatePdf({ inputBuffer, sourceLang, targetLang, options = {} }) {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lv-babeldoc-"));
      const inputPath = path.join(tmpDir, "input.pdf");
      const outputPath = path.join(tmpDir, "output.pdf");
      try {
        await fs.writeFile(inputPath, inputBuffer);
        const pythonCmd = process.env.LV_PDF_ENGINE_PYTHON || process.env.LV_PDF_EXTRACTOR_PYTHON || "python";
        const timeoutMs = Math.max(10000, Number(process.env.LV_MODE_B_ENGINE_TIMEOUT_MS || 600000));
        const runnerArgs = [
          BABELDOC_RUNNER,
          "--input",
          inputPath,
          "--output",
          outputPath,
          "--source-lang",
          String(sourceLang || "en"),
          "--target-lang",
          String(targetLang || "tr"),
          "--openai-model",
          String(process.env.OPENAI_MODEL || "gpt-4o-mini"),
          "--job-id",
          String(options.jobId || "")
        ];
        const run = await runPython({
          pythonCmd,
          args: runnerArgs,
          timeoutMs,
          env: {
            ...process.env,
            PYTHONIOENCODING: "utf-8",
            PYTHONUTF8: "1",
            PYTHONPATH: buildPythonPath(process.env.PYTHONPATH || "")
          }
        });

        if (run.timedOut) {
          return { ok: false, engine_used: "babeldoc", error: "PROVIDER_TIMEOUT" };
        }
        if (run.code !== 0) {
          const joined = `${run.stdout}\n${run.stderr}`;
          return {
            ok: false,
            engine_used: "babeldoc",
            error: normalizeEngineError(joined)
          };
        }
        let payload = {};
        try {
          payload = JSON.parse(String(run.stdout || "{}"));
        } catch {
          return {
            ok: false,
            engine_used: "babeldoc",
            error: "PROVIDER_UPSTREAM_ERROR"
          };
        }
        if (!payload.ok) {
          return {
            ok: false,
            engine_used: "babeldoc",
            error: normalizeEngineError(payload.error || payload.error_detail || "")
          };
        }
        const outputBuffer = await fs.readFile(outputPath);
        return {
          ok: true,
          engine_used: "babeldoc",
          outputBuffer,
          metrics: payload.metrics || {}
        };
      } catch (err) {
        return {
          ok: false,
          engine_used: "babeldoc",
          error: normalizeEngineError(String(err?.message || err))
        };
      } finally {
        try {
          await fs.rm(tmpDir, { recursive: true, force: true });
        } catch {
          // ignore cleanup failures
        }
      }
    }
  };
}

