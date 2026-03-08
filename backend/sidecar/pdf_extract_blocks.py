#!/usr/bin/env python3
import json
import re
import sys
import unicodedata
from dataclasses import dataclass

import fitz  # PyMuPDF


def normalize_text(value: str) -> str:
    text = str(value or "")
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("\u00ad", "")  # soft hyphen
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def normalize_key(value: str) -> str:
    text = normalize_text(value).lower()
    text = re.sub(r"\s+", " ", text)
    return text


@dataclass
class LineItem:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float


@dataclass
class RawBlock:
    page_idx: int
    page_height: float
    x0: float
    y0: float
    x1: float
    y1: float
    lines: list[LineItem]


def _split_long_paragraph(text: str, max_len: int = 460) -> list[str]:
    value = normalize_text(text)
    if not value or len(value) <= max_len:
        return [value] if value else []
    out: list[str] = []
    cursor = 0
    while cursor < len(value):
        remain = len(value) - cursor
        if remain <= max_len:
            out.append(value[cursor:].strip())
            break
        target = cursor + max_len
        boundary = -1
        for m in re.finditer(r"[.;:]\s+", value[cursor : min(len(value), cursor + max_len + 120)]):
            boundary = cursor + m.end()
        if boundary <= cursor:
            ws = value.rfind(" ", cursor + 220, target + 1)
            boundary = ws if ws > cursor else target
        out.append(value[cursor:boundary].strip())
        cursor = boundary
        while cursor < len(value) and value[cursor].isspace():
            cursor += 1
    return [p for p in out if p]


def lines_to_paragraph_items(lines: list[LineItem]) -> list[dict]:
    if not lines:
        return []
    heights = [max(1.0, line.y1 - line.y0) for line in lines]
    median_height = sorted(heights)[len(heights) // 2] if heights else 10.0
    gap_threshold = max(4.0, median_height * 0.75)

    paragraphs: list[dict] = []
    current_text = ""
    para_x0 = None
    para_y0 = None
    para_x1 = None
    para_y1 = None
    prev_line = None

    def flush_current():
        nonlocal current_text, para_x0, para_y0, para_x1, para_y1
        if not current_text:
            return
        for part in _split_long_paragraph(current_text):
            paragraphs.append(
                {
                    "text": part,
                    "x0": para_x0 if para_x0 is not None else 50.0,
                    "y0": para_y0 if para_y0 is not None else 50.0,
                    "x1": para_x1 if para_x1 is not None else 550.0,
                    "y1": para_y1 if para_y1 is not None else 70.0,
                }
            )
        current_text = ""
        para_x0 = para_y0 = para_x1 = para_y1 = None

    for line in lines:
        clean = normalize_text(line.text)
        if not clean:
            flush_current()
            prev_line = line
            continue

        heading_like = bool(re.match(r"^\d+\.\s+", clean))
        citation_like = bool(re.match(r"^(vgl\.|siehe|see|cf\.)\s+", clean, flags=re.IGNORECASE))
        break_before = False
        if current_text:
            if re.fullmatch(r"\d+\.", current_text) and clean[:1].isalpha():
                break_before = False
            else:
                if heading_like:
                    break_before = True
                elif citation_like and len(current_text) > 120:
                    break_before = True
                elif prev_line is not None:
                    vertical_gap = line.y0 - prev_line.y1
                    indent_delta = abs(line.x0 - (prev_line.x0 if prev_line else line.x0))
                    if vertical_gap > gap_threshold:
                        break_before = True
                    elif indent_delta > 24 and clean[:1].isupper():
                        break_before = True
        if break_before:
            flush_current()

        if not current_text:
            current_text = clean
            para_x0, para_y0, para_x1, para_y1 = line.x0, line.y0, line.x1, line.y1
        else:
            if current_text.endswith("-") and re.match(
                r"^[a-z\u00e7\u011f\u0131\u00f6\u015f\u00fc\u00e4\u00df]", clean, flags=re.IGNORECASE
            ):
                current_text = current_text[:-1] + clean
            else:
                current_text = f"{current_text} {clean}"
            para_x0 = min(para_x0, line.x0)
            para_y0 = min(para_y0, line.y0)
            para_x1 = max(para_x1, line.x1)
            para_y1 = max(para_y1, line.y1)
        prev_line = line

    flush_current()
    return paragraphs


def lines_to_paragraphs(lines: list[LineItem]) -> list[str]:
    return [item.get("text", "") for item in lines_to_paragraph_items(lines) if item.get("text")]


def fallback_block():
    return {
        "index": 0,
        "page": 1,
        "block_order": 1,
        "paragraph_group": 1,
        "bbox_hint": {"x": 50, "y": 770, "w": 500, "h": 14},
        "text": "[No extractable text found in PDF stream]",
    }


def extract_blocks(path: str):
    doc = fitz.open(path)
    blocks_out = []
    running_index = 0
    raw: list[RawBlock] = []

    for page_idx in range(doc.page_count):
        page = doc.load_page(page_idx)
        page_height = float(page.rect.height)
        page_dict = page.get_text("dict", flags=fitz.TEXT_DEHYPHENATE)
        raw_blocks = page_dict.get("blocks", [])
        page_blocks: list[RawBlock] = []

        for block in raw_blocks:
            if int(block.get("type", 0)) != 0:
                continue
            lines = block.get("lines", [])
            if not lines:
                continue
            line_parts: list[LineItem] = []
            for line in lines:
                spans = line.get("spans", [])
                span_text = "".join(str(span.get("text", "")) for span in spans)
                if normalize_text(span_text):
                    lx0, ly0, lx1, ly1 = line.get("bbox", block.get("bbox", [50, 50, 550, 70]))
                    line_parts.append(
                        LineItem(
                            text=span_text,
                            x0=float(lx0),
                            y0=float(ly0),
                            x1=float(lx1),
                            y1=float(ly1),
                        )
                    )
            if not line_parts:
                continue
            x0, y0, x1, y1 = block.get("bbox", [50, 50, 550, 70])
            page_blocks.append(
                RawBlock(
                    page_idx=page_idx,
                    page_height=page_height,
                    x0=float(x0),
                    y0=float(y0),
                    x1=float(x1),
                    y1=float(y1),
                    lines=line_parts,
                )
            )

        page_blocks.sort(key=lambda b: (b.y0, b.x0))
        raw.extend(page_blocks)

    # Detect repeated margin text (headers/footers) across pages.
    margin_counts: dict[str, int] = {}
    for b in raw:
        text = normalize_text(" ".join(lines_to_paragraphs(b.lines)))
        if not text:
            continue
        near_top = b.y0 <= 80
        near_bottom = (b.page_height - b.y1) <= 40
        if (near_top or near_bottom) and len(text) <= 220:
            key = normalize_key(text)
            margin_counts[key] = margin_counts.get(key, 0) + 1

    suppress_keys = {k for k, v in margin_counts.items() if v >= 2}

    # First-page preamble suppression heuristic:
    # If a very long block appears before the first numbered heading, suppress it.
    page1_blocks = [b for b in raw if b.page_idx == 0]
    suppress_preamble = None
    if page1_blocks:
        heading_y = None
        for b in page1_blocks:
            txt = normalize_text(" ".join(lines_to_paragraphs(b.lines)))
            if re.match(r"^\d+\.\s", txt):
                heading_y = b.y0
                break
        if heading_y is not None:
            candidates = []
            for b in page1_blocks:
                txt = normalize_text(" ".join(lines_to_paragraphs(b.lines)))
                if (
                    len(txt) >= 500
                    and b.y0 < heading_y
                    and b.y0 <= b.page_height * 0.45
                ):
                    candidates.append((len(txt), b))
            if candidates:
                candidates.sort(key=lambda x: x[0], reverse=True)
                suppress_preamble = candidates[0][1]
        if suppress_preamble is None:
            bottom_candidates = []
            for b in page1_blocks:
                txt = normalize_text(" ".join(lines_to_paragraphs(b.lines)))
                if len(txt) >= 500 and b.y0 >= b.page_height * 0.55:
                    bottom_candidates.append((len(txt), b))
            if bottom_candidates:
                bottom_candidates.sort(key=lambda x: x[0], reverse=True)
                suppress_preamble = bottom_candidates[0][1]

    page_orders: dict[int, int] = {}
    paragraph_group = 1
    for b in raw:
        if suppress_preamble is b:
            continue
        paragraph_items = lines_to_paragraph_items(b.lines)
        if not paragraph_items:
            continue
        for paragraph in paragraph_items:
            text = normalize_text(paragraph.get("text", ""))
            if not text:
                continue
            lowered = text.lower()
            # Suppress recurring page labels and institutional margin noise that can dominate body coverage.
            if re.search(r"\bseite\s+\d+\b", lowered):
                continue
            if len(text) <= 96 and re.search(r"\bwissenschaftliche\s+dienste\b", lowered):
                continue
            if len(text) <= 120 and re.search(r"\bfachbereich\s+wd\s*\d+\b", lowered):
                continue
            if re.fullmatch(r"\*{3,}", text):
                continue
            key = normalize_key(text)
            px0 = float(paragraph.get("x0", b.x0))
            py0 = float(paragraph.get("y0", b.y0))
            px1 = float(paragraph.get("x1", b.x1))
            py1 = float(paragraph.get("y1", b.y1))
            near_top = py0 <= 80
            near_bottom = (b.page_height - py1) <= 40
            if key in suppress_keys and (near_top or near_bottom):
                continue
            page_order = page_orders.get(b.page_idx, 0) + 1
            page_orders[b.page_idx] = page_order
            blocks_out.append(
                {
                    "index": running_index,
                    "page": b.page_idx + 1,
                    "block_order": page_order,
                    "paragraph_group": paragraph_group,
                    "bbox_hint": {
                        "x": px0,
                        "y": max(0.0, b.page_height - py0),
                        "w": max(1.0, px1 - px0),
                        "h": max(1.0, py1 - py0),
                    },
                    "text": text,
                }
            )
            running_index += 1
            paragraph_group += 1

    if not blocks_out:
        blocks_out = [fallback_block()]

    return {"blocks": blocks_out}


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    if len(sys.argv) < 2:
        print(json.dumps({"error": "missing_pdf_path"}))
        return 2
    path = sys.argv[1]
    try:
        result = extract_blocks(path)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"error": "extract_failed", "detail": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
