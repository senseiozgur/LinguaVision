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

function blockRole(block) {
  const role = String(block?.block_role || "").toLowerCase();
  if (role === "title" || role === "heading" || role === "citation") return role;
  return "body";
}

function roleStyle(role) {
  if (role === "title") return { fontSize: 13, wrap: 60, beforeGap: 16, afterGap: 16, lineHeight: 16 };
  if (role === "heading") return { fontSize: 12, wrap: 68, beforeGap: 14, afterGap: 14, lineHeight: 15 };
  if (role === "citation") return { fontSize: 10, wrap: 92, beforeGap: 8, afterGap: 10, lineHeight: 12 };
  return { fontSize: 11, wrap: 84, beforeGap: 8, afterGap: 9, lineHeight: 13 };
}

function splitRenderedParagraphs(raw) {
  return String(raw || "")
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitLongBodyParagraphs(text, maxChars = 260) {
  const value = String(text || "").trim();
  if (!value || value.length <= maxChars) return [value];
  const out = [];
  let rest = value;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars + 90);
    let cut = -1;
    const punct = [...window.matchAll(/[.;:!?]\s+/g)];
    if (punct.length) {
      const last = punct[punct.length - 1];
      cut = last.index + last[0].length;
    }
    if (cut < 120) {
      const ws = rest.lastIndexOf(" ", maxChars);
      cut = ws > 100 ? ws : maxChars;
    }
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

function adaptiveStyle(style, role, cursorY, minY) {
  if (role !== "body" && role !== "citation") return style;
  const pressure = cursorY - minY;
  if (pressure > 210) return style;
  const compact = pressure > 140 ? 1 : 2;
  return {
    ...style,
    wrap: Math.min(96, style.wrap + compact * 4),
    lineHeight: Math.max(11, style.lineHeight - compact),
    beforeGap: Math.max(4, style.beforeGap - compact),
    afterGap: Math.max(5, style.afterGap - compact)
  };
}

function buildWrappedLines(raw, role, style, { includeParagraphBreaks = true } = {}) {
  const baseParts = splitRenderedParagraphs(raw);
  const lines = [];
  for (let p = 0; p < baseParts.length; p++) {
    const part = baseParts[p];
    const splitMax = style.wrap >= 90 ? 320 : 260;
    const subParts = role === "body" ? splitLongBodyParagraphs(part, splitMax) : [part];
    for (let s = 0; s < subParts.length; s++) {
      lines.push(...wrapLine(subParts[s], style.wrap));
    }
    if (includeParagraphBreaks && p < baseParts.length - 1) lines.push("");
  }
  return lines;
}

function cleanTransitionText(raw, role, activeSection) {
  let text = String(raw || "").trim();
  if (!text) return text;
  if ((role === "body" || role === "citation") && activeSection) {
    const prefix = new RegExp(`^${activeSection}\\.\\s+`, "i");
    text = text.replace(prefix, "").trim();
    const mid = new RegExp(`([A-Za-z])\\s+${activeSection}\\.\\s+([A-Z])`, "g");
    text = text.replace(mid, "$1. $2");
  }
  return text;
}

function buildPageContentFromBlocks(blocks, { top = 798, minY = 56, lineHeight = 13 } = {}) {
  const rows = ["BT"];
  let cursorY = top;
  let overflow = false;
  let activeSection = null;

  for (const block of blocks) {
    const role = blockRole(block);
    let raw = String(block.translated_text || block.source_text || "").trim();
    const headingMatch = raw.match(/^(\d+)\.\s+/);
    if (role === "heading" && headingMatch) {
      activeSection = headingMatch[1];
    }
    raw = cleanTransitionText(raw, role, activeSection);
    if (!raw) continue;
    let style = adaptiveStyle(roleStyle(role), role, cursorY, minY);
    let lines = buildWrappedLines(raw, role, style);
    const remaining = Math.max(0, cursorY - minY);
    const estimate = style.beforeGap + style.afterGap + lines.length * style.lineHeight;
    if ((role === "body" || role === "citation") && estimate > remaining) {
      style = {
        ...style,
        wrap: Math.min(104, style.wrap + 8),
        lineHeight: Math.max(10, style.lineHeight - 2),
        beforeGap: Math.max(3, style.beforeGap - 2),
        afterGap: Math.max(4, style.afterGap - 2)
      };
      lines = buildWrappedLines(raw, role, style);
      const availableLines = Math.max(0, Math.floor((cursorY - minY) / Math.max(1, style.lineHeight)));
      if (lines.length > availableLines + 1) {
        style = {
          ...style,
          wrap: Math.min(112, style.wrap + 8),
          lineHeight: Math.max(9, style.lineHeight - 1),
          beforeGap: Math.max(2, style.beforeGap - 1),
          afterGap: Math.max(3, style.afterGap - 1)
        };
        lines = buildWrappedLines(raw, role, style, { includeParagraphBreaks: false });
      }
    }
    const fontRef = detectFontRef(raw);
    if (Number.isFinite(block?.bbox_hint?.y)) {
      const anchored = Math.min(cursorY - style.beforeGap, block.bbox_hint.y);
      cursorY = Number.isFinite(anchored) ? anchored : cursorY - style.beforeGap;
    } else {
      cursorY -= style.beforeGap;
    }
    for (let i = 0; i < lines.length; i++) {
      if (cursorY < minY) {
        if (lines.length - i > 2) overflow = true;
        break;
      }
      const baseX = Number.isFinite(block?.bbox_hint?.x) ? block.bbox_hint.x : 50;
      const isContinuation = i > 0 && lines[i - 1] !== "";
      const continuationIndent = (role === "body" || role === "citation") && isContinuation ? 8 : 0;
      const x = baseX + continuationIndent;
      rows.push(`/${fontRef} ${style.fontSize} Tf`);
      rows.push(`1 0 0 1 ${Math.max(40, x)} ${Math.max(minY, cursorY)} Tm`);
      rows.push(`(${escapePdfText(sanitizePdfText(lines[i]))}) Tj`);
      cursorY -= style.lineHeight || lineHeight;
    }
    cursorY -= style.afterGap;
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
