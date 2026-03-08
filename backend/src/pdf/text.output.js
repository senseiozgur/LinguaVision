function escapePdfText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function sanitizePdfText(value) {
  const mapped = String(value || "")
    .replace(/\u00A7/g, "Section ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, "\"")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ");
  return mapped
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wrapLine(text, width = 90) {
  const value = String(text || "").trim();
  if (!value) return [""];
  const out = [];
  let rest = value;
  while (rest.length > width) {
    let cut = rest.lastIndexOf(" ", width);
    if (cut < 30) cut = width;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function detectFontRef(text) {
  // Explicit fallback strategy for Stage-8: Helvetica -> Times-Roman for non-ascii.
  return /[^\x00-\x7F]/.test(String(text || "")) ? "F2" : "F1";
}

function buildPageContentFromBlocks(blocks, { top = 790, minY = 70, lineHeight = 13 } = {}) {
  const rows = ["BT"];
  let cursorY = top;
  let overflow = false;

  for (const block of blocks) {
    const raw = String(block.translated_text || block.source_text || "").trim();
    if (!raw) continue;
    const lines = wrapLine(raw, 90);
    const fontRef = detectFontRef(raw);
    if (Number.isFinite(block?.bbox_hint?.y)) {
      cursorY = Math.min(cursorY, block.bbox_hint.y);
    }
    for (let i = 0; i < lines.length; i++) {
      if (cursorY < minY) {
        overflow = true;
        break;
      }
      const x = Number.isFinite(block?.bbox_hint?.x) ? block.bbox_hint.x : 50;
      rows.push(`/${fontRef} 11 Tf`);
      rows.push(`1 0 0 1 ${Math.max(40, x)} ${Math.max(minY, cursorY)} Tm`);
      rows.push(`(${escapePdfText(sanitizePdfText(lines[i]))}) Tj`);
      cursorY -= lineHeight;
    }
    cursorY -= 6;
    if (overflow) break;
  }

  rows.push("ET");
  return {
    stream: rows.join("\n"),
    overflow
  };
}

function buildPdfFromPageStreams(pageStreams) {
  const objects = [];
  objects.push("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj");

  const pageObjectNumbers = [];
  const contentObjectNumbers = [];
  for (let i = 0; i < pageStreams.length; i++) {
    pageObjectNumbers.push(3 + i * 2);
    contentObjectNumbers.push(4 + i * 2);
  }

  const fontObjNo1 = 3 + pageStreams.length * 2;
  const fontObjNo2 = fontObjNo1 + 1;

  objects.push(
    `2 0 obj << /Type /Pages /Kids [${pageObjectNumbers.map((n) => `${n} 0 R`).join(" ")}] /Count ${pageStreams.length} >> endobj`
  );

  for (let i = 0; i < pageStreams.length; i++) {
    const pageObjNo = pageObjectNumbers[i];
    const contentObjNo = contentObjectNumbers[i];
    objects.push(
      `${pageObjNo} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontObjNo1} 0 R /F2 ${fontObjNo2} 0 R >> >> /Contents ${contentObjNo} 0 R >> endobj`
    );
    const content = pageStreams[i];
    const contentBytes = Buffer.from(content, "utf8");
    objects.push(`${contentObjNo} 0 obj << /Length ${contentBytes.length} >> stream\n${content}\nendstream endobj`);
  }

  objects.push(`${fontObjNo1} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`);
  objects.push(`${fontObjNo2} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >> endobj`);

  const header = "%PDF-1.4\n";
  let body = "";
  const offsets = [0];
  let cursor = Buffer.byteLength(header, "utf8");
  for (const obj of objects) {
    offsets.push(cursor);
    body += `${obj}\n`;
    cursor += Buffer.byteLength(`${obj}\n`, "utf8");
  }

  const xrefOffset = cursor;
  let xref = `xref\n0 ${objects.length + 1}\n`;
  xref += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }

  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(`${header}${body}${xref}${trailer}`, "utf8");
}

export function buildLayoutAwareTextPdf(layoutModel, { title = "LinguaVision Mode-B Output" } = {}) {
  // Stage-8 acceptance targets: preserve page count/order, avoid empty output, and surface overflow flags.
  const pages = Array.isArray(layoutModel?.pages) && layoutModel.pages.length
    ? layoutModel.pages
    : [{ page: 1, blocks: [{ translated_text: title, bbox_hint: { x: 50, y: 790 } }] }];

  const pageStreams = [];
  let overflowPages = 0;
  let blockCount = 0;
  for (const page of pages) {
    const blocks = (page.blocks || []).slice().sort((a, b) => (a.block_order || 0) - (b.block_order || 0));
    blockCount += blocks.length;
    const { stream, overflow } = buildPageContentFromBlocks(blocks);
    if (overflow) overflowPages += 1;
    pageStreams.push(stream);
  }

  return {
    outputBuffer: buildPdfFromPageStreams(pageStreams),
    metrics: {
      page_count: pages.length,
      block_count: blockCount,
      overflow_flag: overflowPages > 0,
      overflow_pages: overflowPages,
      reflow_strategy: "mode_b_layout_v2",
      font_fallback: ["Helvetica", "Times-Roman"]
    }
  };
}

export function buildSimpleTextPdf(text, { title = "LinguaVision Mode-B Output" } = {}) {
  const layoutModel = {
    pages: [
      {
        page: 1,
        blocks: [
          {
            block_order: 1,
            translated_text: [title, "", String(text || "")].join("\n"),
            bbox_hint: { x: 50, y: 790 }
          }
        ]
      }
    ]
  };
  return buildLayoutAwareTextPdf(layoutModel, { title }).outputBuffer;
}
