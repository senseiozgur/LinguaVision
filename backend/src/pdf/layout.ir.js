function splitEvenly(text, parts) {
  const normalized = String(text || "").trim();
  if (parts <= 1) return [normalized];
  if (!normalized) return Array.from({ length: parts }, () => "");

  const out = [];
  let cursor = 0;
  for (let i = 0; i < parts; i++) {
    const remainingParts = parts - i;
    const remainingChars = normalized.length - cursor;
    const target = Math.max(1, Math.floor(remainingChars / remainingParts));
    let next = cursor + target;
    if (i < parts - 1) {
      const ws = normalized.indexOf(" ", next);
      if (ws > next && ws - next < 20) next = ws;
    } else {
      next = normalized.length;
    }
    out.push(normalized.slice(cursor, next).trim());
    cursor = Math.min(normalized.length, next + 1);
  }
  return out;
}

export function buildModeBLayoutModel({ blocks, chunks, translatedChunks }) {
  const byChunkIndex = new Map();
  for (const item of translatedChunks || []) {
    byChunkIndex.set(item.index, String(item.text || ""));
  }

  const translatedByBlock = new Map();
  for (const chunk of chunks || []) {
    const source = Array.isArray(chunk.source_indexes) ? chunk.source_indexes : [];
    if (!source.length) continue;
    const translated = byChunkIndex.get(chunk.index) ?? String(chunk.text || "");
    const parts = splitEvenly(translated, source.length);
    for (let i = 0; i < source.length; i++) {
      const key = source[i];
      const existing = translatedByBlock.get(key);
      const next = parts[i] || "";
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
      translated_text: translatedByBlock.get(Number.isFinite(block.index) ? block.index : index) || String(block.text || "")
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
