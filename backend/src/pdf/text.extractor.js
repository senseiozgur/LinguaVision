import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SIDECAR_SCRIPT = path.resolve(__dirname, "../../sidecar/pdf_extract_blocks.py");
const FALLBACK_TEXT = "[No extractable text found in PDF stream]";

function defaultFallbackBlock() {
  return {
    index: 0,
    page: 1,
    block_order: 1,
    paragraph_group: 1,
    bbox_hint: { x: 50, y: 770, w: 500, h: 14 },
    text: FALLBACK_TEXT
  };
}

function normalizePdfText(text) {
  return String(text || "")
    .replace(/\\n/g, " ")
    .replace(/\\r/g, " ")
    .replace(/\\t/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeExtractedBlocks(value) {
  const source = Array.isArray(value) ? value : [];
  const out = [];
  for (let i = 0; i < source.length; i++) {
    const item = source[i] || {};
    const text = normalizePdfText(item.text || "");
    if (!text) continue;
    const bbox = item.bbox_hint || {};
    out.push({
      index: Number.isFinite(item.index) ? item.index : i,
      page: Number.isFinite(item.page) ? item.page : 1,
      block_order: Number.isFinite(item.block_order) ? item.block_order : i + 1,
      paragraph_group: Number.isFinite(item.paragraph_group) ? item.paragraph_group : i + 1,
      bbox_hint: {
        x: Number.isFinite(bbox.x) ? bbox.x : 50,
        y: Number.isFinite(bbox.y) ? bbox.y : 770,
        w: Number.isFinite(bbox.w) ? bbox.w : 500,
        h: Number.isFinite(bbox.h) ? bbox.h : 14
      },
      text
    });
  }
  if (!out.length) return [defaultFallbackBlock()];
  return out.sort((a, b) => a.index - b.index);
}

function extractBySidecar(inputBuffer) {
  const pythonCmd = process.env.LV_PDF_EXTRACTOR_PYTHON || "python";
  const tmpFile = path.join(os.tmpdir(), `lv-extract-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`);
  fs.writeFileSync(tmpFile, inputBuffer);
  try {
    const run = spawnSync(pythonCmd, [SIDECAR_SCRIPT, tmpFile], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });
    if (run.error) throw run.error;
    if (run.status !== 0) {
      throw new Error((run.stderr || run.stdout || "").trim() || `sidecar_exit_${run.status}`);
    }
    const parsed = JSON.parse(String(run.stdout || "{}"));
    return normalizeExtractedBlocks(parsed.blocks);
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore temp cleanup failures
    }
  }
}

function extractTextOpsFromBlock(blockRaw) {
  const out = [];
  const tjOps = blockRaw.match(/\(([^)]{1,1200})\)\s*Tj/g) || [];
  for (const op of tjOps) {
    const m = op.match(/\(([^)]*)\)\s*Tj/);
    if (!m) continue;
    const value = normalizePdfText(m[1]);
    if (value) out.push(value);
  }

  const tjArrayOps = blockRaw.match(/\[([^\]]{1,2500})\]\s*TJ/g) || [];
  for (const op of tjArrayOps) {
    const m = op.match(/\[([^\]]*)\]\s*TJ/);
    if (!m) continue;
    const parts = m[1].match(/\(([^)]*)\)/g) || [];
    const joined = normalizePdfText(parts.map((p) => p.slice(1, -1)).join(" "));
    if (joined) out.push(joined);
  }
  return out;
}

function estimatePageCount(raw) {
  const explicit = raw.match(/\/Type\s*\/Page\b/g) || [];
  return Math.max(1, explicit.length);
}

function extractByLegacyRegex(inputBuffer) {
  const raw = inputBuffer.toString("latin1");
  const btEtBlocks = raw.match(/BT[\s\S]*?ET/g) || [];
  const pageCount = estimatePageCount(raw);
  const collected = [];

  for (let i = 0; i < btEtBlocks.length; i++) {
    const textParts = extractTextOpsFromBlock(btEtBlocks[i]);
    if (!textParts.length) continue;
    const blockText = normalizePdfText(textParts.join(" "));
    if (!blockText) continue;
    collected.push(blockText);
  }

  if (!collected.length) return [defaultFallbackBlock()];

  return collected.map((text, index) => {
    const page = Math.min(pageCount, Math.floor((index * pageCount) / collected.length) + 1);
    const localOrder = Math.floor((index * 1000) / collected.length) + 1;
    return {
      index,
      page,
      block_order: localOrder,
      paragraph_group: localOrder,
      bbox_hint: {
        x: 50,
        y: Math.max(80, 790 - ((localOrder - 1) % 40) * 16),
        w: 500,
        h: 14
      },
      text
    };
  });
}

export function extractPdfTextBlocks(inputBuffer) {
  const sidecarEnabled = process.env.LV_PDF_EXTRACTOR_DISABLE_SIDECAR !== "1";
  const sidecarAvailable = fs.existsSync(SIDECAR_SCRIPT);
  if (sidecarEnabled && sidecarAvailable) {
    try {
      return extractBySidecar(inputBuffer);
    } catch {
      return extractByLegacyRegex(inputBuffer);
    }
  }
  return extractByLegacyRegex(inputBuffer);
}
