import argparse
import asyncio
import json
import os
import shutil
import sys
from pathlib import Path


def build_parser():
    parser = argparse.ArgumentParser(description="LinguaVision BabelDOC runner")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--source-lang", default="en")
    parser.add_argument("--target-lang", required=True)
    parser.add_argument("--openai-model", default="gpt-4o-mini")
    parser.add_argument("--job-id", default="")
    parser.add_argument("--watermark-output-mode", default="no_watermark")
    parser.add_argument("--primary-font-family", default="")
    parser.add_argument("--disable-rich-text-translate", action="store_true")
    parser.add_argument("--split-short-lines", action="store_true")
    parser.add_argument("--short-line-split-factor", type=float, default=0.8)
    parser.add_argument("--disable-content-filter-hint", action="store_true")
    return parser


async def run_translate(args):
    from babeldoc.format.pdf import high_level as babeldoc_high_level
    from babeldoc.docvision.doclayout import DocLayoutModel
    from babeldoc.format.pdf.high_level import async_translate
    from babeldoc.format.pdf.translation_config import WatermarkOutputMode
    from babeldoc.format.pdf.translation_config import TranslationConfig
    from babeldoc.translator.translator import OpenAITranslator
    from babeldoc.translator.translator import set_translate_rate_limiter
    from babeldoc.format.pdf.document_il.midend import il_translator as il_translator_module

    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    source_lang = str(args.source_lang or "en").strip()
    target_lang = str(args.target_lang or "").strip()
    if not target_lang:
        return {"ok": False, "error": "target_lang missing"}
    wm_mode_raw = str(args.watermark_output_mode or "no_watermark").strip().lower()
    wm_mode = {
        "watermarked": WatermarkOutputMode.Watermarked,
        "no_watermark": WatermarkOutputMode.NoWatermark,
        "both": WatermarkOutputMode.Both
    }.get(wm_mode_raw, WatermarkOutputMode.NoWatermark)
    primary_font = str(args.primary_font_family or "").strip() or None
    if primary_font not in [None, "serif", "sans-serif", "script"]:
        return {"ok": False, "error": f"invalid primary_font_family: {primary_font}"}
    effective_config = {
        "lang_in": source_lang,
        "lang_out": target_lang,
        "watermark_output_mode": wm_mode.value,
        "primary_font_family": primary_font,
        "disable_rich_text_translate": bool(args.disable_rich_text_translate),
        "split_short_lines": bool(args.split_short_lines),
        "short_line_split_factor": float(args.short_line_split_factor),
        "disable_content_filter_hint": bool(args.disable_content_filter_hint),
    }
    print(
        f"ENGINE_CONFIG {json.dumps(effective_config, ensure_ascii=False)}",
        file=sys.stderr
    )

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return {"ok": False, "error": "OPENAI_API_KEY missing"}

    translator = OpenAITranslator(
        lang_in=source_lang,
        lang_out=target_lang,
        model=args.openai_model,
        base_url=os.getenv("OPENAI_BASE_URL") or None,
        api_key=api_key,
        ignore_cache=True,
        enable_json_mode_if_requested=False,
        send_dashscope_header=False,
        send_temperature=True,
    )
    set_translate_rate_limiter(2)

    # Product mode: suppress user-facing content-filter hint insertion in output PDFs.
    content_filter_hint_calls = 0
    original_add_content_filter_hint = il_translator_module.ILTranslator.add_content_filter_hint

    def patched_add_content_filter_hint(self, page, paragraph):
        nonlocal content_filter_hint_calls
        content_filter_hint_calls += 1
        if bool(args.disable_content_filter_hint):
            print(
                "ENGINE_NOTICE content_filter_hint_suppressed=true",
                file=sys.stderr,
            )
            return
        return original_add_content_filter_hint(self, page, paragraph)

    il_translator_module.ILTranslator.add_content_filter_hint = patched_add_content_filter_hint

    babeldoc_high_level.init()
    layout_model = DocLayoutModel.load_onnx()

    config = TranslationConfig(
        translator=translator,
        input_file=str(input_path),
        lang_in=source_lang,
        lang_out=target_lang,
        doc_layout_model=layout_model,
        output_dir=str(output_path.parent),
        no_dual=True,
        no_mono=False,
        qps=2,
        watermark_output_mode=wm_mode,
        primary_font_family=primary_font,
        disable_rich_text_translate=bool(args.disable_rich_text_translate),
        split_short_lines=bool(args.split_short_lines),
        short_line_split_factor=float(args.short_line_split_factor),
    )

    result = None
    try:
        async for event in async_translate(config):
            if event.get("type") == "error":
                return {"ok": False, "error": str(event.get("error") or "engine_error")}
            if event.get("type") == "finish":
                result = event.get("translate_result")
                break
    finally:
        il_translator_module.ILTranslator.add_content_filter_hint = original_add_content_filter_hint

    if result is None:
        return {"ok": False, "error": "engine_no_result"}

    result_path = getattr(result, "no_watermark_mono_pdf_path", None) or getattr(result, "mono_pdf_path", None)
    if not result_path:
        return {"ok": False, "error": "engine_output_missing"}
    result_path = Path(result_path)
    if not result_path.exists():
        return {"ok": False, "error": "engine_output_missing"}

    shutil.copyfile(result_path, output_path)
    try:
        import pymupdf

        doc = pymupdf.open(str(output_path))
        page_count = doc.page_count
        doc.close()
    except Exception:
        page_count = 0

    return {
        "ok": True,
        "engine_used": "babeldoc",
        "metrics": {
            "page_count": int(page_count),
            "overflow_flag": False,
            "content_filter_hint_triggered_count": int(content_filter_hint_calls),
            "content_filter_hint_suppressed": bool(args.disable_content_filter_hint),
            "engine_config": effective_config
        },
    }


def main():
    parser = build_parser()
    args = parser.parse_args()
    try:
        payload = asyncio.run(run_translate(args))
        if payload.get("ok"):
            print(json.dumps(payload, ensure_ascii=False))
            raise SystemExit(0)
        print(json.dumps(payload, ensure_ascii=False))
        raise SystemExit(1)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
