#!/usr/bin/env python3
import json
import re
import sys

import fitz  # PyMuPDF


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def collect_stats(pdf_path: str) -> dict:
    doc = fitz.open(pdf_path)
    lines: list[str] = []
    paragraphs: list[str] = []
    headings = 0

    for i in range(doc.page_count):
        page = doc.load_page(i)
        text = page.get_text("text") or ""
        raw_lines = [normalize_text(x) for x in text.splitlines()]
        cleaned_lines = [x for x in raw_lines if x]
        lines.extend(cleaned_lines)

        for line in cleaned_lines:
            if re.match(r"^\d+(\.\d+)*\s+\S+", line):
                headings += 1

        raw_paras = [normalize_text(x) for x in re.split(r"\n\s*\n", text)]
        paragraphs.extend([x for x in raw_paras if x])

    total_chars = sum(len(x) for x in lines)
    line_count = len(lines)
    avg_line_len = (total_chars / line_count) if line_count else 0.0
    dense_over90 = sum(1 for x in lines if len(x) > 90)
    dense_over100 = sum(1 for x in lines if len(x) > 100)
    para_count = len(paragraphs)
    para_total_chars = sum(len(x) for x in paragraphs)
    avg_para_len = (para_total_chars / para_count) if para_count else 0.0
    sample = " ".join(lines[:6])[:240]

    return {
        "page_count": doc.page_count,
        "text_length": total_chars,
        "line_count": line_count,
        "avg_line_len": round(avg_line_len, 2),
        "dense_over90": dense_over90,
        "dense_over100": dense_over100,
        "paragraph_count": para_count,
        "avg_paragraph_len": round(avg_para_len, 2),
        "headings_detected": headings,
        "sample_text": sample,
    }


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "missing_pdf_path"}))
        return 2
    pdf_path = sys.argv[1]
    try:
        print(json.dumps(collect_stats(pdf_path), ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"error": "stats_failed", "detail": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
