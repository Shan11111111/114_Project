from __future__ import annotations

from pathlib import Path
from typing import Tuple
import re

# -------------------------
# Text helpers
# -------------------------
def _clean_text(t: str) -> str:
    t = (t or "").replace("\r\n", "\n").replace("\r", "\n")
    # 合併過多空白，但保留換行
    lines = []
    for line in t.split("\n"):
        line = re.sub(r"[ \t]+", " ", line).strip()
        if line:
            lines.append(line)
    return "\n".join(lines).strip()

def _make_summary(t: str, max_chars: int = 1200) -> str:
    """
    產出「像摘要」的條列重點：
    - 先抓最常見的關鍵句（含：注意事項/適應症/步驟/警訊/何時就醫/禁忌）
    - 不夠再補前段內容
    """
    t = _clean_text(t)
    if not t:
        return ""

    lines = [ln.strip() for ln in t.split("\n") if ln.strip()]
    if not lines:
        return ""

    # 你這類醫院衛教單常見關鍵詞
    keywords = [
        "注意", "警訊", "何時", "就醫", "回診", "傷口", "換藥", "浸泡",
        "消毒", "感染", "紅", "腫", "熱", "痛", "流膿", "發燒",
        "步驟", "方法", "需", "請", "避免", "不可", "禁忌",
        "目的", "適應", "適用", "處置", "藥", "敷料"
    ]

    picked = []
    seen = set()

    def add(line: str):
        s = line.strip()
        if not s:
            return
        if s in seen:
            return
        seen.add(s)
        picked.append(s)

    # 1) 先抓含關鍵詞的句子
    for ln in lines:
        if any(k in ln for k in keywords):
            add(ln)
        if len(picked) >= 10:
            break

    # 2) 不足的話，補前面幾行有資訊密度的
    if len(picked) < 6:
        for ln in lines[:20]:
            # 避免全是單位/日期/編號那種
            if any(x in ln for x in ["編號", "核可", "製作單位", "科別"]):
                continue
            add(ln)
            if len(picked) >= 8:
                break

    # 3) 組成條列摘要
    out = []
    total = 0
    for i, ln in enumerate(picked, 1):
        item = f"- {ln}"
        if total + len(item) > max_chars:
            break
        out.append(item)
        total += len(item)

    return "\n".join(out).strip()

# -------------------------
# Extractors
# -------------------------
def _extract_pdf(path: Path) -> str:
    # 1) 優先用 PyMuPDF（fitz）通常最好
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(str(path))
        texts = []
        for page in doc:
            texts.append(page.get_text("text") or "")
        doc.close()
        return "\n".join(texts)
    except Exception:
        pass

    # 2) 次選 pdfplumber
    try:
        import pdfplumber
        texts = []
        with pdfplumber.open(str(path)) as pdf:
            for p in pdf.pages:
                texts.append(p.extract_text() or "")
        return "\n".join(texts)
    except Exception:
        pass

    # 3) 再退：pypdf
    try:
        from pypdf import PdfReader
        r = PdfReader(str(path))
        texts = []
        for p in r.pages:
            texts.append(p.extract_text() or "")
        return "\n".join(texts)
    except Exception as e:
        raise RuntimeError(f"PDF 解析器不可用或解析失敗：{e}")

def _extract_txt_like(path: Path) -> str:
    # txt/csv 都當文字檔讀
    return path.read_text(encoding="utf-8", errors="ignore")

def _extract_docx(path: Path) -> str:
    try:
        import docx  # python-docx
        d = docx.Document(str(path))
        return "\n".join([p.text for p in d.paragraphs])
    except Exception as e:
        raise RuntimeError(f"DOCX 解析失敗：{e}")

def _extract_pptx(path: Path) -> str:
    try:
        from pptx import Presentation
        prs = Presentation(str(path))
        texts = []
        for slide in prs.slides:
            for shape in slide.shapes:
                if hasattr(shape, "text"):
                    texts.append(shape.text or "")
        return "\n".join(texts)
    except Exception as e:
        raise RuntimeError(f"PPTX 解析失敗：{e}")

def _extract_xlsx(path: Path) -> str:
    try:
        import openpyxl
        wb = openpyxl.load_workbook(str(path), data_only=True)
        texts = []
        for ws in wb.worksheets:
            texts.append(f"[Sheet] {ws.title}")
            for row in ws.iter_rows(values_only=True):
                line = " ".join([str(x) for x in row if x is not None]).strip()
                if line:
                    texts.append(line)
        return "\n".join(texts)
    except Exception as e:
        raise RuntimeError(f"XLSX 解析失敗：{e}")

# -------------------------
# Public API
# -------------------------
def extract_text_and_summary(file_path: Path, ext: str) -> Tuple[str, str]:
    """
    ✅ 保證回 (text, summary)
    - 成功：回文字 + 摘要
    - 抽不到：raise RuntimeError（讓 main.py 顯示 extract_warning）
    """
    p = Path(file_path)
    e = (ext or "").lower().lstrip(".")

    if not p.exists():
        raise RuntimeError(f"檔案不存在：{p}")

    if e == "pdf":
        text = _extract_pdf(p)
    elif e in ("txt", "csv"):
        text = _extract_txt_like(p)
    elif e in ("doc", "docx"):
        # doc 舊格式很麻煩，先只保 docx；doc 直接報錯比較誠實
        if e == "doc":
            raise RuntimeError("不支援 .doc（請轉成 .docx）")
        text = _extract_docx(p)
    elif e in ("ppt", "pptx"):
        if e == "ppt":
            raise RuntimeError("不支援 .ppt（請轉成 .pptx）")
        text = _extract_pptx(p)
    elif e in ("xls", "xlsx"):
        if e == "xls":
            raise RuntimeError("不支援 .xls（請轉成 .xlsx）")
        text = _extract_xlsx(p)
    else:
        raise RuntimeError(f"不支援的檔案格式：.{e}")

    text = _clean_text(text)

    # 這裡很關鍵：PDF 若是掃描圖（沒文字層），文字會空
    if not text:
        raise RuntimeError("抽不到文字：可能是掃描 PDF（沒有文字層），或檔案內容不可抽取。")

    summary = _make_summary(text)
    return text, summary
