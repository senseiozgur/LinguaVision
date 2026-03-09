import fs from "fs/promises";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../..");
const BABELDOC_RUNNER = path.resolve(REPO_ROOT, "scripts/babeldoc_runner.py");

function parseBooleanEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const v = String(raw).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

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

function parseRunnerJson(stdoutText = "") {
  const raw = String(stdoutText || "");
  const lines = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line.startsWith("{")) continue;
    try {
      return JSON.parse(line);
    } catch {
      // continue scanning older lines
    }
  }
  return null;
}

export function createBabelDocEngine() {
  return {
    async translatePdf({ inputBuffer, sourceLang, targetLang, options = {} }) {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lv-babeldoc-"));
      const inputPath = path.join(tmpDir, "input.pdf");
      const outputPath = path.join(tmpDir, "output.pdf");
      try {
        const resolvedTargetLang = String(targetLang || "").trim();
        if (!resolvedTargetLang) {
          return {
            ok: false,
            engine_used: "babeldoc",
            error: "PROVIDER_UPSTREAM_ERROR",
            error_detail: "target_lang_missing",
            metrics: {
              engine_config: {
                lang_in: String(sourceLang || "en").trim() || "en",
                lang_out: "",
                watermark_output_mode: String(process.env.LV_BABELDOC_WATERMARK_MODE || "no_watermark").trim().toLowerCase() || "no_watermark",
                primary_font_family: null,
                disable_rich_text_translate: parseBooleanEnv("LV_BABELDOC_DISABLE_RICH_TEXT_TRANSLATE", false),
                split_short_lines: parseBooleanEnv("LV_BABELDOC_SPLIT_SHORT_LINES", false),
                short_line_split_factor: Number(process.env.LV_BABELDOC_SHORT_LINE_SPLIT_FACTOR || 0.8)
              }
            }
          };
        }
        const resolvedSourceLang = String(sourceLang || "en").trim() || "en";
        const watermarkOutputMode = String(process.env.LV_BABELDOC_WATERMARK_MODE || "no_watermark").trim().toLowerCase();
        const primaryFontFamilyRaw = String(process.env.LV_BABELDOC_PRIMARY_FONT_FAMILY || "sans-serif").trim().toLowerCase();
        const primaryFontFamily = ["serif", "sans-serif", "script"].includes(primaryFontFamilyRaw)
          ? primaryFontFamilyRaw
          : "";
        const disableRichTextTranslate = parseBooleanEnv("LV_BABELDOC_DISABLE_RICH_TEXT_TRANSLATE", false);
        const splitShortLines = parseBooleanEnv("LV_BABELDOC_SPLIT_SHORT_LINES", false);
        const shortLineSplitFactor = Number(process.env.LV_BABELDOC_SHORT_LINE_SPLIT_FACTOR || 0.8);
        const effectiveConfig = {
          lang_in: resolvedSourceLang,
          lang_out: resolvedTargetLang,
          watermark_output_mode: watermarkOutputMode || "no_watermark",
          primary_font_family: primaryFontFamily || null,
          disable_rich_text_translate: disableRichTextTranslate,
          split_short_lines: splitShortLines,
          short_line_split_factor: Number.isFinite(shortLineSplitFactor) ? shortLineSplitFactor : 0.8
        };
        console.log("BABELDOC_ENGINE_CONFIG", JSON.stringify({
          job_id: String(options.jobId || ""),
          request_id: String(options.requestId || ""),
          ...effectiveConfig
        }));

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
          resolvedSourceLang,
          "--target-lang",
          resolvedTargetLang,
          "--openai-model",
          String(process.env.OPENAI_MODEL || "gpt-4o-mini"),
          "--job-id",
          String(options.jobId || "")
        ];
        runnerArgs.push("--watermark-output-mode", effectiveConfig.watermark_output_mode);
        if (effectiveConfig.primary_font_family) {
          runnerArgs.push("--primary-font-family", effectiveConfig.primary_font_family);
        }
        if (effectiveConfig.disable_rich_text_translate) {
          runnerArgs.push("--disable-rich-text-translate");
        }
        if (effectiveConfig.split_short_lines) {
          runnerArgs.push("--split-short-lines");
          runnerArgs.push("--short-line-split-factor", String(effectiveConfig.short_line_split_factor));
        }
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
          return {
            ok: false,
            engine_used: "babeldoc",
            error: "PROVIDER_TIMEOUT",
            metrics: { engine_config: effectiveConfig }
          };
        }
        if (run.code !== 0) {
          const joined = `${run.stdout}\n${run.stderr}`;
          return {
            ok: false,
            engine_used: "babeldoc",
            error: normalizeEngineError(joined),
            metrics: { engine_config: effectiveConfig }
          };
        }
        let payload = {};
        payload = parseRunnerJson(run.stdout || "");
        if (!payload) {
          return {
            ok: false,
            engine_used: "babeldoc",
            error: "PROVIDER_UPSTREAM_ERROR",
            metrics: { engine_config: effectiveConfig }
          };
        }
        if (!payload.ok) {
          return {
            ok: false,
            engine_used: "babeldoc",
            error: normalizeEngineError(payload.error || payload.error_detail || ""),
            metrics: { engine_config: effectiveConfig }
          };
        }
        const outputBuffer = await fs.readFile(outputPath);
        return {
          ok: true,
          engine_used: "babeldoc",
          outputBuffer,
          metrics: {
            ...(payload.metrics || {}),
            engine_config: (payload.metrics && payload.metrics.engine_config) || effectiveConfig
          }
        };
      } catch (err) {
        return {
          ok: false,
          engine_used: "babeldoc",
          error: normalizeEngineError(String(err?.message || err)),
          metrics: {
            engine_config: {
              lang_in: String(sourceLang || "en").trim() || "en",
              lang_out: String(targetLang || "").trim(),
              watermark_output_mode: String(process.env.LV_BABELDOC_WATERMARK_MODE || "no_watermark").trim().toLowerCase() || "no_watermark",
              primary_font_family: null,
              disable_rich_text_translate: parseBooleanEnv("LV_BABELDOC_DISABLE_RICH_TEXT_TRANSLATE", false),
              split_short_lines: parseBooleanEnv("LV_BABELDOC_SPLIT_SHORT_LINES", false),
              short_line_split_factor: Number(process.env.LV_BABELDOC_SHORT_LINE_SPLIT_FACTOR || 0.8)
            }
          }
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
