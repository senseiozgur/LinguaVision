function normalizePdfText(text) {
  return String(text || "")
    .replace(/\\n/g, " ")
    .replace(/\\r/g, " ")
    .replace(/\\t/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

export function extractPdfTextBlocks(inputBuffer) {
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

  if (collected.length === 0) {
    return [
      {
        index: 0,
        page: 1,
        block_order: 1,
        paragraph_group: 1,
        bbox_hint: { x: 50, y: 770, w: 500, h: 14 },
        text: "[No extractable text found in PDF stream]"
      }
    ];
  }

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
