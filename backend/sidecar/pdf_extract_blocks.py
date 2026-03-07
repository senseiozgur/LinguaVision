#!/usr/bin/env python3
import json
import re
import sys

import fitz  # PyMuPDF


def normalize_text(value: str) -> str:
    text = str(value or "")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


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

    for page_idx in range(doc.page_count):
        page = doc.load_page(page_idx)
        page_height = float(page.rect.height)
        page_dict = page.get_text("dict", flags=fitz.TEXT_DEHYPHENATE)
        raw_blocks = page_dict.get("blocks", [])
        page_block_order = 1

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
                line_text = normalize_text(span_text)
                if line_text:
                    line_parts.append(line_text)

            text = normalize_text(" ".join(line_parts))
            if not text:
                continue

            x0, y0, x1, y1 = block.get("bbox", [50, 50, 550, 70])
            blocks_out.append(
                {
                    "index": running_index,
                    "page": page_idx + 1,
                    "block_order": page_block_order,
                    "paragraph_group": page_block_order,
                    "bbox_hint": {
                        "x": float(x0),
                        "y": max(0.0, page_height - float(y0)),
                        "w": max(1.0, float(x1) - float(x0)),
                        "h": max(1.0, float(y1) - float(y0)),
                    },
                    "text": text,
                }
            )
            running_index += 1
            page_block_order += 1

    if not blocks_out:
        blocks_out = [fallback_block()]

    return {"blocks": blocks_out}


def main():
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

