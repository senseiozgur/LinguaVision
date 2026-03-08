function seekBoundary(text, target, fallbackMax = 40) {
  const min = Math.max(1, target - fallbackMax);
  const max = Math.min(text.length - 1, target + fallbackMax);
  for (let i = target; i <= max; i++) {
    if (/\s/.test(text[i])) return i;
  }
  for (let i = target; i >= min; i--) {
    if (/\s/.test(text[i])) return i;
  }
  return target;
}

function splitBySourceLengths(translatedText, sourceTexts) {
  const normalized = String(translatedText || "").trim();
  const count = Array.isArray(sourceTexts) ? sourceTexts.length : 0;
  if (count <= 1) return [normalized];
  if (!normalized) return Array.from({ length: count }, () => "");

  const sourceLengths = sourceTexts.map((t) => Math.max(1, String(t || "").trim().length));
  const totalWeight = sourceLengths.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    return Array.from({ length: count }, (_, i) => {
      const avg = Math.floor(normalized.length / count);
      const from = i * avg;
      const to = i === count - 1 ? normalized.length : (i + 1) * avg;
      return normalized.slice(from, to).trim();
    });
  }

  const out = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const remainingParts = count - i;
    const remainingChars = normalized.length - cursor;
    if (remainingParts <= 1) {
      out.push(normalized.slice(cursor).trim());
      break;
    }
    const remainingWeight = sourceLengths.slice(i).reduce((a, b) => a + b, 0);
    const portion = sourceLengths[i] / remainingWeight;
    let target = cursor + Math.max(1, Math.round(remainingChars * portion));
    target = Math.min(normalized.length - 1, Math.max(cursor + 1, target));
    const boundary = seekBoundary(normalized, target, 48);
    out.push(normalized.slice(cursor, boundary).trim());
    cursor = Math.min(normalized.length, boundary + 1);
  }
  while (out.length < count) out.push("");
  return out;
}

function preserveHeadingPrefix(sourceText, translatedPart) {
  const source = String(sourceText || "").trim();
  const translated = String(translatedPart || "").trim();
  const m = source.match(/^(\d+\.)\s+/);
  if (!m) return translated;
  if (!translated) return source;
  let body = translated;
  const sameNumber = m[1].replace(".", "\\.");
  body = body.replace(new RegExp(`\\b${sameNumber}\\s+`, "g"), "").trim();
  if (/^\d+\.\s+/.test(body)) return body;
  if (body.length > 140) {
    const cut = body.search(/[;:.!?]\s/);
    if (cut > 28 && cut < 140) body = body.slice(0, cut + 1).trim();
    else body = body.slice(0, 140).trim();
  }
  return `${m[1]} ${body}`.trim();
}

function detectBlockRole(sourceText) {
  const text = String(sourceText || "").trim();
  if (!text) return "body";
  if (/^kurzinformation\b/i.test(text)) return "title";
  if (/^\d+\.\s+/.test(text)) return "heading";
  if (/^(vgl\.|siehe|see|cf\.)\s+/i.test(text)) return "citation";
  if (text.length <= 72 && !/[.!?]$/.test(text) && /^[A-ZÄÖÜ]/.test(text)) return "heading";
  return "body";
}

export function buildModeBLayoutModel({ blocks, chunks, translatedChunks }) {
  const sourceByIndex = new Map(
    (blocks || []).map((block, index) => [
      Number.isFinite(block.index) ? block.index : index,
      String(block.text || "")
    ])
  );
  const byChunkIndex = new Map();
  for (const item of translatedChunks || []) {
    byChunkIndex.set(item.index, String(item.text || ""));
  }

  const translatedByBlock = new Map();
  for (const chunk of chunks || []) {
    const source = Array.isArray(chunk.source_indexes) ? chunk.source_indexes : [];
    if (!source.length) continue;
    const translated = byChunkIndex.get(chunk.index) ?? String(chunk.text || "");
    const sourceTexts = source.map((idx) => sourceByIndex.get(idx) || "");
    const parts = splitBySourceLengths(translated, sourceTexts);
    for (let i = 0; i < source.length; i++) {
      const key = source[i];
      const existing = translatedByBlock.get(key);
      const next = preserveHeadingPrefix(sourceTexts[i], parts[i] || "");
      translatedByBlock.set(key, existing ? `${existing}\n${next}`.trim() : next.trim());
    }
  }

  const normalizedBlocks = (blocks || [])
    .map((block, index) => ({
      index: Number.isFinite(block.index) ? block.index : index,
      page: Number.isFinite(block.page) ? block.page : 1,
      block_order: Number.isFinite(block.block_order) ? block.block_order : index + 1,
      bbox_hint: block.bbox_hint || { x: 50, y: 780 - index * 16, w: 500, h: 14 },
      source_text: String(block.text || ""),
      translated_text: translatedByBlock.get(Number.isFinite(block.index) ? block.index : index) || String(block.text || ""),
      block_role: detectBlockRole(String(block.text || ""))
    }))
    .sort((a, b) => (a.page - b.page) || (a.block_order - b.block_order));

  const pagesMap = new Map();
  for (const block of normalizedBlocks) {
    if (!pagesMap.has(block.page)) pagesMap.set(block.page, []);
    pagesMap.get(block.page).push(block);
  }

  const pages = [...pagesMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([page, pageBlocks]) => ({
      page,
      blocks: pageBlocks
    }));

  return {
    pages,
    block_count: normalizedBlocks.length,
    page_count: pages.length
  };
}
