import argparse
import asyncio
import json
import os
import shutil
from pathlib import Path


def build_parser():
    parser = argparse.ArgumentParser(description="LinguaVision BabelDOC runner")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--source-lang", default="en")
    parser.add_argument("--target-lang", default="tr")
    parser.add_argument("--openai-model", default="gpt-4o-mini")
    parser.add_argument("--job-id", default="")
    return parser


async def run_translate(args):
    from babeldoc.format.pdf import high_level as babeldoc_high_level
    from babeldoc.docvision.doclayout import DocLayoutModel
    from babeldoc.format.pdf.high_level import async_translate
    from babeldoc.format.pdf.translation_config import TranslationConfig
    from babeldoc.translator.translator import OpenAITranslator
    from babeldoc.translator.translator import set_translate_rate_limiter

    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return {"ok": False, "error": "OPENAI_API_KEY missing"}

    translator = OpenAITranslator(
        lang_in=args.source_lang,
        lang_out=args.target_lang,
        model=args.openai_model,
        base_url=os.getenv("OPENAI_BASE_URL") or None,
        api_key=api_key,
        ignore_cache=True,
        enable_json_mode_if_requested=False,
        send_dashscope_header=False,
        send_temperature=True,
    )
    set_translate_rate_limiter(2)
    babeldoc_high_level.init()
    layout_model = DocLayoutModel.load_onnx()

    config = TranslationConfig(
        translator=translator,
        input_file=str(input_path),
        lang_in=args.source_lang,
        lang_out=args.target_lang,
        doc_layout_model=layout_model,
        output_dir=str(output_path.parent),
        no_dual=True,
        no_mono=False,
        qps=2,
    )

    result = None
    async for event in async_translate(config):
        if event.get("type") == "error":
            return {"ok": False, "error": str(event.get("error") or "engine_error")}
        if event.get("type") == "finish":
            result = event.get("translate_result")
            break

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
            "overflow_flag": False
        }
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
