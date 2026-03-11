import fs from "fs/promises";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../..");
const BABELDOC_RUNNER = path.resolve(REPO_ROOT, "scripts/babeldoc_runner.py");
const DEFAULT_RUNTIME_TIMEOUT_MS = 8000;

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

function parseRequiredRuntime(raw = "3.12") {
  const t = String(raw || "").trim();
  const match = t.match(/^(\d+)\.(\d+)$/);
  if (!match) return { major: 3, minor: 12, raw: "3.12" };
  return { major: Number(match[1]), minor: Number(match[2]), raw: t };
}

function parseVersionTuple(raw = "") {
  const match = String(raw || "").match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] || 0),
    raw: match[0]
  };
}

function isSameMajorMinor(a, b) {
  if (!a || !b) return false;
  return Number(a.major) === Number(b.major) && Number(a.minor) === Number(b.minor);
}

function safeParseJson(text = "") {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
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

async function validatePythonRuntime({ pythonCmd, env }) {
  const required = parseRequiredRuntime(process.env.LV_PDF_ENGINE_REQUIRED_PYTHON || "3.12");
  const probeScript =
    "import sys, json; print(json.dumps({'executable': sys.executable, 'version': sys.version.split()[0]}), flush=True)";
  const probe = await runPython({
    pythonCmd,
    args: ["-c", probeScript],
    env,
    timeoutMs: Math.max(1000, Number(process.env.LV_PDF_ENGINE_RUNTIME_TIMEOUT_MS || DEFAULT_RUNTIME_TIMEOUT_MS))
  });

  const validation = {
    ok: false,
    required_python: required.raw,
    python_cmd: pythonCmd,
    python_executable: null,
    python_version: null,
    runtime_error_class: null,
    runtime_error_detail: null
  };

  if (probe.timedOut) {
    validation.runtime_error_class = "ENGINE_RUNTIME_TIMEOUT";
    validation.runtime_error_detail = "runtime_probe_timeout";
    return validation;
  }
  if (probe.code === -1) {
    validation.runtime_error_class = "ENGINE_RUNTIME_SPAWN_FAILED";
    validation.runtime_error_detail = String(probe.stderr || "runtime_probe_spawn_failed").trim();
    return validation;
  }
  if (probe.code !== 0) {
    validation.runtime_error_class = "ENGINE_RUNTIME_PROBE_FAILED";
    validation.runtime_error_detail = String(`${probe.stdout}\n${probe.stderr}`).trim();
    return validation;
  }

  const payload = safeParseJson(String(probe.stdout || "").trim());
  const runtimeVersion = parseVersionTuple(payload?.version || "");
  validation.python_executable = payload?.executable || null;
  validation.python_version = payload?.version || null;

  if (!runtimeVersion) {
    validation.runtime_error_class = "ENGINE_RUNTIME_VERSION_PARSE_FAILED";
    validation.runtime_error_detail = String(probe.stdout || "").trim();
    return validation;
  }

  if (!isSameMajorMinor(runtimeVersion, required)) {
    validation.runtime_error_class = "ENGINE_RUNTIME_VERSION_MISMATCH";
    validation.runtime_error_detail = `required=${required.raw}; actual=${runtimeVersion.raw}`;
    return validation;
  }

  validation.ok = true;
  return validation;
}

export function createBabelDocEngine() {
  return {
    async validateRuntime() {
      const pythonCmd = process.env.LV_PDF_ENGINE_PYTHON || process.env.LV_PDF_EXTRACTOR_PYTHON || "python";
      return validatePythonRuntime({
        pythonCmd,
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
          PYTHONPATH: buildPythonPath(process.env.PYTHONPATH || "")
        }
      });
    },
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
                short_line_split_factor: Number(process.env.LV_BABELDOC_SHORT_LINE_SPLIT_FACTOR || 0.8),
                disable_content_filter_hint: parseBooleanEnv("LV_BABELDOC_DISABLE_CONTENT_FILTER_HINT", true),
                tls_mode: String(process.env.LV_BABELDOC_CA_BUNDLE || "").trim() ? "ca_bundle" : (parseBooleanEnv("LV_BABELDOC_INSECURE_TLS", false) ? "insecure" : "default"),
                ca_bundle_path: String(process.env.LV_BABELDOC_CA_BUNDLE || "").trim() || null,
                insecure_tls: parseBooleanEnv("LV_BABELDOC_INSECURE_TLS", false),
                allow_source_fallback_on_repetition: parseBooleanEnv(
                  "LV_BABELDOC_ALLOW_SOURCE_FALLBACK_ON_REPETITION",
                  false
                )
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
        const disableContentFilterHint = parseBooleanEnv("LV_BABELDOC_DISABLE_CONTENT_FILTER_HINT", true);
        const caBundlePath = String(process.env.LV_BABELDOC_CA_BUNDLE || "").trim();
        const insecureTls = parseBooleanEnv("LV_BABELDOC_INSECURE_TLS", false);
        const tlsMode = caBundlePath ? "ca_bundle" : (insecureTls ? "insecure" : "default");
        const allowSourceFallbackOnRepetition = parseBooleanEnv(
          "LV_BABELDOC_ALLOW_SOURCE_FALLBACK_ON_REPETITION",
          false
        );
        const effectiveConfig = {
          lang_in: resolvedSourceLang,
          lang_out: resolvedTargetLang,
          watermark_output_mode: watermarkOutputMode || "no_watermark",
          primary_font_family: primaryFontFamily || null,
          disable_rich_text_translate: disableRichTextTranslate,
          split_short_lines: splitShortLines,
          short_line_split_factor: Number.isFinite(shortLineSplitFactor) ? shortLineSplitFactor : 0.8,
          disable_content_filter_hint: disableContentFilterHint,
          tls_mode: tlsMode,
          ca_bundle_path: caBundlePath || null,
          insecure_tls: insecureTls,
          allow_source_fallback_on_repetition: allowSourceFallbackOnRepetition
        };
        const pythonCmd = process.env.LV_PDF_ENGINE_PYTHON || process.env.LV_PDF_EXTRACTOR_PYTHON || "python";
        const runtimeEnv = {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
          PYTHONPATH: buildPythonPath(process.env.PYTHONPATH || "")
        };
        const runtimeValidation = await validatePythonRuntime({
          pythonCmd,
          env: runtimeEnv
        });
        if (!runtimeValidation.ok) {
          return {
            ok: false,
            engine_used: "babeldoc",
            error: "PROVIDER_UPSTREAM_ERROR",
            metrics: {
              engine_config: effectiveConfig,
              runtime_validation: runtimeValidation,
              runtime_error_class: runtimeValidation.runtime_error_class
            }
          };
        }
        console.log("BABELDOC_ENGINE_CONFIG", JSON.stringify({
          job_id: String(options.jobId || ""),
          request_id: String(options.requestId || ""),
          ...effectiveConfig,
          python_executable: runtimeValidation.python_executable || pythonCmd,
          python_version: runtimeValidation.python_version || null,
          required_python: runtimeValidation.required_python,
          engine_concurrency: options?.concurrency || null
        }));

        await fs.writeFile(inputPath, inputBuffer);
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
        if (effectiveConfig.disable_content_filter_hint) {
          runnerArgs.push("--disable-content-filter-hint");
        }
        const run = await runPython({
          pythonCmd,
          args: runnerArgs,
          timeoutMs,
          env: runtimeEnv
        });

        if (run.timedOut) {
          return {
            ok: false,
            engine_used: "babeldoc",
            error: "PROVIDER_TIMEOUT",
            metrics: {
              engine_config: effectiveConfig,
              runtime_validation: runtimeValidation,
              runtime_error_class: "ENGINE_SUBPROCESS_TIMEOUT"
            }
          };
        }
        if (run.code === -1) {
          return {
            ok: false,
            engine_used: "babeldoc",
            error: "PROVIDER_UPSTREAM_ERROR",
            metrics: {
              engine_config: effectiveConfig,
              runtime_validation: runtimeValidation,
              runtime_error_class: "ENGINE_SUBPROCESS_SPAWN_FAILED"
            }
          };
        }
        if (run.code !== 0) {
          const joined = `${run.stdout}\n${run.stderr}`;
          return {
            ok: false,
            engine_used: "babeldoc",
            error: normalizeEngineError(joined),
            metrics: {
              engine_config: effectiveConfig,
              runtime_validation: runtimeValidation,
              runtime_error_class: "ENGINE_SUBPROCESS_NONZERO"
            }
          };
        }
        let payload = {};
        payload = parseRunnerJson(run.stdout || "");
        if (!payload) {
          return {
            ok: false,
            engine_used: "babeldoc",
            error: "PROVIDER_UPSTREAM_ERROR",
            metrics: {
              engine_config: effectiveConfig,
              runtime_validation: runtimeValidation,
              runtime_error_class: "ENGINE_OUTPUT_PARSE_FAILED"
            }
          };
        }
        if (!payload.ok) {
          return {
            ok: false,
            engine_used: "babeldoc",
            error: normalizeEngineError(payload.error || payload.error_detail || ""),
            metrics: {
              engine_config: effectiveConfig,
              runtime_validation: runtimeValidation,
              runtime_error_class: "ENGINE_RUNTIME_EXECUTION_FAILED"
            }
          };
        }
        const outputBuffer = await fs.readFile(outputPath);
        return {
          ok: true,
          engine_used: "babeldoc",
          outputBuffer,
          metrics: {
            ...(payload.metrics || {}),
            engine_config: (payload.metrics && payload.metrics.engine_config) || effectiveConfig,
            runtime_validation: runtimeValidation
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
              short_line_split_factor: Number(process.env.LV_BABELDOC_SHORT_LINE_SPLIT_FACTOR || 0.8),
              disable_content_filter_hint: parseBooleanEnv("LV_BABELDOC_DISABLE_CONTENT_FILTER_HINT", true),
              tls_mode: String(process.env.LV_BABELDOC_CA_BUNDLE || "").trim() ? "ca_bundle" : (parseBooleanEnv("LV_BABELDOC_INSECURE_TLS", false) ? "insecure" : "default"),
              ca_bundle_path: String(process.env.LV_BABELDOC_CA_BUNDLE || "").trim() || null,
              insecure_tls: parseBooleanEnv("LV_BABELDOC_INSECURE_TLS", false),
              allow_source_fallback_on_repetition: parseBooleanEnv(
                "LV_BABELDOC_ALLOW_SOURCE_FALLBACK_ON_REPETITION",
                false
              ),
              runtime_error_class: "ENGINE_RUNTIME_EXCEPTION"
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
