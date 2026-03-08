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
class RawBlock:
    page_idx: int
    page_height: float
    x0: float
    y0: float
    x1: float
    y1: float
    lines: list[str]


def lines_to_paragraphs(lines: list[str]) -> list[str]:
    if not lines:
        return []
    paragraphs: list[str] = []
    current = ""
    for line in lines:
        clean = normalize_text(line)
        if not clean:
            if current:
                paragraphs.append(current)
                current = ""
            continue
        if not current:
            current = clean
            continue
        if current.endswith("-") and re.match(
            r"^[a-z\u00e7\u011f\u0131\u00f6\u015f\u00fc\u00e4\u00df]", clean, flags=re.IGNORECASE
        ):
            current = current[:-1] + clean
        else:
            current = f"{current} {clean}"
    if current:
        paragraphs.append(current)
    return [p for p in paragraphs if p]


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
            line_parts = []
            for line in lines:
                spans = line.get("spans", [])
                span_text = "".join(str(span.get("text", "")) for span in spans)
                if normalize_text(span_text):
                    line_parts.append(span_text)
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
        paragraphs = lines_to_paragraphs(b.lines)
        if not paragraphs:
            continue
        text = normalize_text(" ".join(paragraphs))
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
        near_top = b.y0 <= 80
        near_bottom = (b.page_height - b.y1) <= 40
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
                    "x": b.x0,
                    "y": max(0.0, b.page_height - b.y0),
                    "w": max(1.0, b.x1 - b.x0),
                    "h": max(1.0, b.y1 - b.y0),
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
