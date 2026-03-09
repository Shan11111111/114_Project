# app/tools/doc_tool_ext.py(HTML跟Md的)
from __future__ import annotations

from pathlib import Path
from typing import Tuple
import re

from .doc_tool import extract_text_and_summary as _extract_core  # 你原本的，不動


def _strip_html(raw: str) -> str:
    # 不靠 bs4，先用超保守版（夠用、依賴少）
    raw = re.sub(r"(?is)<script.*?>.*?</script>", "\n", raw)
    raw = re.sub(r"(?is)<style.*?>.*?</style>", "\n", raw)
    raw = re.sub(r"(?s)<[^>]+>", "\n", raw)
    raw = raw.replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
    # 合併空白
    lines = []
    for ln in raw.splitlines():
        ln = re.sub(r"[ \t]+", " ", ln).strip()
        if ln:
            lines.append(ln)
    return "\n".join(lines).strip()


def extract_text_and_summary_extended(file_path: Path, ext: str) -> Tuple[str, str]:
    """
    你原本 doc_tool.py 不支援 md/html，所以用這個擴充版：
    - md  => 當 txt 處理（交給原本 extract_text_and_summary）
    - html/htm => 先 strip tag，再用“類 txt”的摘要方式
    - 其他 => 原封不動交給你原本 extract_text_and_summary
    """
    p = Path(file_path)
    e = (ext or "").lower().lstrip(".")

    if e == "md":
        return _extract_core(p, "txt")

    if e in ("html", "htm"):
        raw = p.read_text(encoding="utf-8", errors="ignore")
        text = _strip_html(raw)
        if not text:
            raise RuntimeError("抽不到文字：HTML 內容可能為空或主要內容在 script 動態渲染。")
        # 這裡偷吃步：把 html 當 txt 交給你原本摘要器
        tmp = p.with_suffix(".txt.__tmp__")
        tmp.write_text(text, encoding="utf-8")
        try:
            return _extract_core(tmp, "txt")
        finally:
            try:
                tmp.unlink(missing_ok=True)
            except Exception:
                pass

    return _extract_core(p, e)
