export function chunkTextBlocks(blocks, { targetSize = 1800, maxSize = 2000 } = {}) {
  const normalized = (blocks || [])
    .map((b, index) => ({ index: Number.isFinite(b.index) ? b.index : index, text: String(b.text || "").trim() }))
    .filter((b) => b.text.length > 0)
    .sort((a, b) => a.index - b.index);

  const chunks = [];
  let current = "";
  let sourceIndexes = [];

  for (const block of normalized) {
    const candidate = current ? `${current}\n\n${block.text}` : block.text;
    if (candidate.length <= targetSize || current.length === 0) {
      current = candidate;
      sourceIndexes.push(block.index);
      continue;
    }

    chunks.push({ index: chunks.length, text: current, source_indexes: sourceIndexes });
    current = block.text;
    sourceIndexes = [block.index];

    if (current.length > maxSize) {
      let cursor = 0;
      while (cursor < current.length) {
        const piece = current.slice(cursor, cursor + maxSize);
        chunks.push({ index: chunks.length, text: piece, source_indexes: sourceIndexes });
        cursor += maxSize;
      }
      current = "";
      sourceIndexes = [];
    }
  }

  if (current.length > 0) {
    chunks.push({ index: chunks.length, text: current, source_indexes: sourceIndexes });
  }

  return chunks;
}
