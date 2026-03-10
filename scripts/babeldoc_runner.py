import argparse
import asyncio
import json
import os
import re
import shutil
import statistics as py_statistics
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
    from babeldoc.format.pdf.document_il.midend import il_translator_llm_only as il_translator_llm_only_module
    from babeldoc.translator import translator as babeldoc_translator_module
    from babeldoc.translator.translator import OpenAITranslator
    from babeldoc.translator.translator import set_translate_rate_limiter
    from babeldoc.format.pdf.document_il.midend import il_translator as il_translator_module
    from babeldoc.format.pdf.document_il.midend import typesetting as typesetting_module

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
    repetition_max_10gram = int(
        str(os.getenv("LV_BABELDOC_REPETITION_MAX_10GRAM", "5")).strip() or "5"
    )
    effective_config["repetition_max_10gram"] = int(repetition_max_10gram)
    allow_source_fallback_on_repetition = (
        str(
            os.getenv("LV_BABELDOC_ALLOW_SOURCE_FALLBACK_ON_REPETITION", "0")
        ).strip().lower()
        in {"1", "true", "yes", "on"}
    )
    effective_config["allow_source_fallback_on_repetition"] = bool(
        allow_source_fallback_on_repetition
    )
    scale_harmonization_patch_active = str(
        os.getenv("LV_BABELDOC_PATCH_SCALE_HARMONIZATION", "1")
    ).strip().lower() not in {"0", "false", "no", "off"}
    effective_config["patch_scale_harmonization"] = bool(
        scale_harmonization_patch_active
    )

    ca_bundle_raw = str(os.getenv("LV_BABELDOC_CA_BUNDLE", "")).strip()
    insecure_tls = (
        str(os.getenv("LV_BABELDOC_INSECURE_TLS", "0")).strip().lower()
        in {"1", "true", "yes", "on"}
    )
    tls_mode = "default"
    tls_verify = True
    ca_bundle_path = None
    if ca_bundle_raw:
        ca_candidate = Path(ca_bundle_raw).expanduser().resolve()
        if not ca_candidate.exists():
            return {
                "ok": False,
                "error": f"invalid_ca_bundle_path: {ca_candidate}",
            }
        tls_mode = "ca_bundle"
        ca_bundle_path = str(ca_candidate)
        tls_verify = ca_bundle_path
        os.environ["SSL_CERT_FILE"] = ca_bundle_path
        os.environ["REQUESTS_CA_BUNDLE"] = ca_bundle_path
        os.environ["CURL_CA_BUNDLE"] = ca_bundle_path
    elif insecure_tls:
        tls_mode = "insecure"
        tls_verify = False
        os.environ["PYTHONHTTPSVERIFY"] = "0"
    effective_config["tls_mode"] = tls_mode
    effective_config["ca_bundle_path"] = ca_bundle_path
    effective_config["insecure_tls"] = bool(insecure_tls)
    print(
        f"ENGINE_CONFIG {json.dumps(effective_config, ensure_ascii=False)}",
        file=sys.stderr
    )

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return {"ok": False, "error": "OPENAI_API_KEY missing"}

    original_httpx_client_factory = babeldoc_translator_module.httpx.Client

    class LvPatchedHttpxClient(original_httpx_client_factory):
        def __init__(self, *f_args, **f_kwargs):
            if "verify" not in f_kwargs:
                f_kwargs["verify"] = tls_verify
            super().__init__(*f_args, **f_kwargs)

    babeldoc_translator_module.httpx.Client = LvPatchedHttpxClient
    try:
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
    except Exception:
        babeldoc_translator_module.httpx.Client = original_httpx_client_factory
        raise
    set_translate_rate_limiter(2)

    # Sanitize Chinese hardcoded example in BabelDOC LLM-only prompt template.
    try:
        prompt_template = il_translator_llm_only_module.PROMPT_TEMPLATE.template
        prompt_template = prompt_template.replace(
            "<style id='2'>你好</style>，世界！",
            "<style id='2'>translated text</style>, translated world!",
        )
        il_translator_llm_only_module.PROMPT_TEMPLATE.template = prompt_template
    except Exception:
        # Keep translation path resilient if internals change.
        pass

    # Product mode: suppress user-facing content-filter hint insertion in output PDFs.
    content_filter_hint_calls = 0
    original_add_content_filter_hint = il_translator_module.ILTranslator.add_content_filter_hint
    original_post_translate_paragraph = il_translator_module.ILTranslator.post_translate_paragraph
    original_multimode = typesetting_module.statistics.multimode
    scale_stats = {
        "paragraph_scale_count": 0,
        "paragraph_scale_min": None,
        "paragraph_scale_median": None,
        "paragraph_scale_p10": None,
        "paragraph_scale_p25": None,
    }
    repetition_guard = {
        "checked": 0,
        "suspect_count": 0,
        "repetition_retry_count": 0,
        "repetition_retry_success_count": 0,
        "source_fallback_count": 0,
        "hard_fail_count": 0,
        "max_10gram_repeat_seen": 0,
        "hard_fail_paragraphs": [],
        "samples": [],
    }

    def _max_10gram_repeat(text: str) -> int:
        words = re.findall(r"\w+", str(text or "").lower(), flags=re.UNICODE)
        if len(words) < 10:
            return 0
        counter = {}
        for i in range(len(words) - 9):
            key = " ".join(words[i : i + 10])
            counter[key] = counter.get(key, 0) + 1
        return int(max(counter.values()) if counter else 0)

    def _percentile(sorted_values, p):
        if not sorted_values:
            return None
        if len(sorted_values) == 1:
            return float(sorted_values[0])
        k = (len(sorted_values) - 1) * p
        f = int(k)
        c = min(f + 1, len(sorted_values) - 1)
        if f == c:
            return float(sorted_values[f])
        d0 = sorted_values[f] * (c - k)
        d1 = sorted_values[c] * (k - f)
        return float(d0 + d1)

    def _normalize_for_compare(text: str) -> str:
        return re.sub(r"\s+", " ", str(text or "")).strip().lower()

    def patched_multimode(values):
        vals = [float(x) for x in list(values) if x is not None]
        if vals:
            vals.sort()
            scale_stats["paragraph_scale_count"] = int(len(vals))
            scale_stats["paragraph_scale_min"] = float(vals[0])
            scale_stats["paragraph_scale_median"] = float(py_statistics.median(vals))
            scale_stats["paragraph_scale_p10"] = _percentile(vals, 0.10)
            scale_stats["paragraph_scale_p25"] = _percentile(vals, 0.25)
            # Return a robust center so BabelDOC's min(multimode(...)) clamp
            # does not collapse all paragraphs to an outlier small scale.
            return [scale_stats["paragraph_scale_median"]]
        return original_multimode(values)

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

    def patched_post_translate_paragraph(
        self, paragraph, tracker, translate_input, translated_text: str
    ):
        source_text = str(
            getattr(paragraph, "_lv_repeat_guard_source_text", getattr(paragraph, "unicode", ""))
            or ""
        )
        normalized_source = _normalize_for_compare(source_text)

        # If repetition was detected before, this is the single retry/fallback candidate.
        if getattr(paragraph, "_lv_repeat_guard_allow_once", False):
            paragraph._lv_repeat_guard_allow_once = False
            repeat_score_retry = _max_10gram_repeat(translated_text)
            is_source_like_retry = (
                normalized_source
                and _normalize_for_compare(translated_text) == normalized_source
            )
            if (
                repeat_score_retry > repetition_max_10gram
                or is_source_like_retry
            ):
                repetition_guard["hard_fail_count"] += 1
                para_id = getattr(paragraph, "debug_id", None)
                if len(repetition_guard["hard_fail_paragraphs"]) < 10:
                    repetition_guard["hard_fail_paragraphs"].append(
                        {
                            "paragraph_debug_id": para_id,
                            "repeat_score": int(repeat_score_retry),
                            "source_like": bool(is_source_like_retry),
                        }
                    )
                if allow_source_fallback_on_repetition:
                    repetition_guard["source_fallback_count"] += 1
                    print(
                        f"ENGINE_WARNING repetition_guard_source_fallback=true paragraph_debug_id={para_id}",
                        file=sys.stderr,
                    )
                    return False
                print(
                    f"ENGINE_WARNING repetition_guard_hard_fail=true paragraph_debug_id={para_id} repeat_score={repeat_score_retry} source_like={is_source_like_retry}",
                    file=sys.stderr,
                )
                paragraph._lv_repeat_guard_hard_fail = True
                raise RuntimeError(
                    f"repetition_guard_unresolved paragraph_debug_id={para_id} repeat_score={repeat_score_retry} source_like={is_source_like_retry}"
                )

            repetition_guard["repetition_retry_success_count"] += 1
            return original_post_translate_paragraph(
                self, paragraph, tracker, translate_input, translated_text
            )

        repeat_score = _max_10gram_repeat(translated_text)
        repetition_guard["checked"] += 1
        repetition_guard["max_10gram_repeat_seen"] = max(
            int(repetition_guard["max_10gram_repeat_seen"]), int(repeat_score)
        )
        if repeat_score > repetition_max_10gram:
            repetition_guard["suspect_count"] += 1
            repetition_guard["repetition_retry_count"] += 1
            if len(repetition_guard["samples"]) < 5:
                repetition_guard["samples"].append(
                    {
                        "paragraph_debug_id": getattr(paragraph, "debug_id", None),
                        "repeat_score": int(repeat_score),
                        "text_len": len(str(translated_text or "")),
                    }
                )
            paragraph._lv_repeat_guard_source_text = str(
                getattr(paragraph, "unicode", "") or ""
            )
            paragraph._lv_repeat_guard_allow_once = True
            print(
                f"ENGINE_WARNING repetition_guard_triggered=true repeat_score={repeat_score} threshold={repetition_max_10gram} paragraph_debug_id={getattr(paragraph, 'debug_id', '')}",
                file=sys.stderr,
            )
            raise ValueError(
                f"repetition_guard_triggered repeat_score={repeat_score} threshold={repetition_max_10gram}"
            )

        return original_post_translate_paragraph(
            self, paragraph, tracker, translate_input, translated_text
        )

    il_translator_module.ILTranslator.add_content_filter_hint = patched_add_content_filter_hint
    il_translator_module.ILTranslator.post_translate_paragraph = (
        patched_post_translate_paragraph
    )
    if scale_harmonization_patch_active:
        typesetting_module.statistics.multimode = patched_multimode

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
        babeldoc_translator_module.httpx.Client = original_httpx_client_factory
        il_translator_module.ILTranslator.add_content_filter_hint = original_add_content_filter_hint
        il_translator_module.ILTranslator.post_translate_paragraph = (
            original_post_translate_paragraph
        )
        typesetting_module.statistics.multimode = original_multimode

    if result is None:
        return {"ok": False, "error": "engine_no_result"}
    if (
        not allow_source_fallback_on_repetition
        and int(repetition_guard["hard_fail_count"] or 0) > 0
    ):
        return {
            "ok": False,
            "error": "repetition_guard_unresolved",
            "metrics": {
                "target_lang": target_lang,
                "repetition_guard_checked_count": int(repetition_guard["checked"]),
                "repetition_suspect_count": int(repetition_guard["suspect_count"]),
                "repetition_retry_count": int(
                    repetition_guard["repetition_retry_count"]
                ),
                "repetition_retry_success_count": int(
                    repetition_guard["repetition_retry_success_count"]
                ),
                "source_fallback_count": int(
                    repetition_guard["source_fallback_count"]
                ),
                "hard_fail_count": int(repetition_guard["hard_fail_count"]),
                "allow_source_fallback_on_repetition": bool(
                    allow_source_fallback_on_repetition
                ),
                "repetition_guard_samples": repetition_guard["samples"],
                "repetition_guard_hard_fail_paragraphs": repetition_guard[
                    "hard_fail_paragraphs"
                ],
                "engine_config": effective_config,
            },
        }

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
        visible_char_count = 0
        visible_cjk_count = 0
        for i in range(doc.page_count):
            page = doc.load_page(i)
            text = page.get_text("text") or ""
            visible_char_count += len(text)
            for seg in page.get_texttrace():
                if seg.get("type", None) == 3:
                    continue
                chars = []
                for ch in seg.get("chars", []):
                    if ch and isinstance(ch[0], int):
                        chars.append(chr(ch[0]))
                if chars:
                    visible_cjk_count += len(
                        re.findall(r"[\u4e00-\u9fff]", "".join(chars))
                    )
        doc.close()
    except Exception:
        page_count = 0
        visible_char_count = 0
        visible_cjk_count = 0

    visible_cjk_ratio = (
        float(visible_cjk_count) / float(visible_char_count)
        if visible_char_count > 0
        else 0.0
    )
    non_cjk_target = str(target_lang or "").strip().lower() not in {
        "zh",
        "zh-cn",
        "zh-tw",
        "zh-hans",
        "zh-hant",
        "ja",
        "ko",
    }
    cjk_residue_warning = bool(non_cjk_target and visible_cjk_count > 0)
    if cjk_residue_warning:
        print("ENGINE_WARNING visible_cjk_residue_detected=true", file=sys.stderr)

    return {
        "ok": True,
        "engine_used": "babeldoc",
        "metrics": {
            "page_count": int(page_count),
            "overflow_flag": False,
            "target_lang": target_lang,
            "provider": "openai_compatible",
            "model": str(args.openai_model or "").strip(),
            "output_cjk_count": int(visible_cjk_count),
            "output_cjk_ratio": round(float(visible_cjk_ratio), 6),
            "output_visible_char_count": int(visible_char_count),
            "cjk_residue_warning": cjk_residue_warning,
            "content_filter_hint_triggered_count": int(content_filter_hint_calls),
            "content_filter_hint_suppressed": bool(args.disable_content_filter_hint),
            "repetition_guard_checked_count": int(repetition_guard["checked"]),
            "repetition_suspect_count": int(repetition_guard["suspect_count"]),
            "repetition_retry_count": int(repetition_guard["repetition_retry_count"]),
            "repetition_retry_success_count": int(
                repetition_guard["repetition_retry_success_count"]
            ),
            "source_fallback_count": int(repetition_guard["source_fallback_count"]),
            "hard_fail_count": int(repetition_guard["hard_fail_count"]),
            "allow_source_fallback_on_repetition": bool(
                allow_source_fallback_on_repetition
            ),
            "repetition_guard_max_10gram_repeat_seen": int(
                repetition_guard["max_10gram_repeat_seen"]
            ),
            "repetition_guard_threshold": int(repetition_max_10gram),
            "repetition_guard_samples": repetition_guard["samples"],
            "repetition_guard_hard_fail_paragraphs": repetition_guard[
                "hard_fail_paragraphs"
            ],
            "global_scale_patch_active": bool(scale_harmonization_patch_active),
            "paragraph_scale_count": int(scale_stats["paragraph_scale_count"] or 0),
            "paragraph_scale_min": scale_stats["paragraph_scale_min"],
            "paragraph_scale_median": scale_stats["paragraph_scale_median"],
            "paragraph_scale_p10": scale_stats["paragraph_scale_p10"],
            "paragraph_scale_p25": scale_stats["paragraph_scale_p25"],
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
