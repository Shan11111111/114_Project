from __future__ import annotations

from pathlib import Path
from typing import Tuple, Optional
import csv

from PyPDF2 import PdfReader
import pdfplumber
from docx import Document
import openpyxl

try:
    # pptx 文字抽取用
    from pptx import Presentation  # pip install python-pptx
except Exception:
    Presentation = None


def _read_text_best_effort(path: Path) -> str:
    """
    盡量把 txt/csv 類的文字讀出來：先 utf-8-sig，不行再 big5，再不行就 ignore。
    """
    for enc in ("utf-8-sig", "utf-8", "big5", "cp950"):
        try:
            return path.read_text(encoding=enc, errors="strict")
        except Exception:
            pass
    return path.read_text(encoding="utf-8", errors="ignore")


def _summarize(full_text: str, max_chars: int = 600) -> str:
    lines = [ln.strip() for ln in (full_text or "").splitlines() if ln.strip()]
    joined = "\n".join(lines)
    return joined[:max_chars]


def extract_text_and_summary(path: Path | str, ext: Optional[str] = None) -> Tuple[str, str]:
    """
    讀取檔案內容並產生簡單摘要。

    path: 檔案路徑
    ext : 副檔名（不含 .），例如 'pdf'、'pptx'、'ppt'、'txt'、'docx'、'xlsx'、'csv'
          若為 None，則會從 path.suffix 自動判斷
    """
    if isinstance(path, str):
        path = Path(path)

    if ext is None:
        ext = path.suffix.lower().lstrip(".")
    else:
        ext = ext.lower().lstrip(".")

    full_text = ""

    # --- PDF ---
    if ext == "pdf":
        try:
            with pdfplumber.open(path) as pdf:
                texts = []
                for page in pdf.pages:
                    texts.append(page.extract_text() or "")
                full_text = "\n".join(texts)
        except Exception:
            reader = PdfReader(str(path))
            texts = []
            for page in reader.pages:
                texts.append(page.extract_text() or "")
            full_text = "\n".join(texts)

    # --- Word ---
    elif ext == "docx":
        doc = Document(str(path))
        full_text = "\n".join(p.text for p in doc.paragraphs)

    # --- Excel ---
    elif ext in {"xlsx", "xls"}:
        wb = openpyxl.load_workbook(path, data_only=True)
        rows_text: list[str] = []
        for sheet in wb.worksheets:
            rows_text.append(f"[Sheet] {sheet.title}")
            for row in sheet.iter_rows(values_only=True):
                cells = ["" if v is None else str(v) for v in row]
                # 避免整行都是空白就塞垃圾
                if any(c.strip() for c in cells):
                    rows_text.append("  ".join(cells))
        full_text = "\n".join(rows_text)

    # --- 純文字 ---
    elif ext == "txt":
        full_text = _read_text_best_effort(path)

    # --- CSV ---
    elif ext == "csv":
        raw = _read_text_best_effort(path)
        # 用 Sniffer 猜分隔符（猜不到就用逗號）
        try:
            dialect = csv.Sniffer().sniff(raw[:4096])
        except Exception:
            dialect = csv.excel

        rows_text: list[str] = []
        reader = csv.reader(raw.splitlines(), dialect=dialect)
        for i, row in enumerate(reader):
            # 避免超爆長：最多抓前 500 行，夠做摘要/RAG
            if i >= 500:
                rows_text.append("...(CSV 內容過長，後續省略)")
                break
            rows_text.append("  ".join(cell.strip() for cell in row if cell is not None))
        full_text = "\n".join(rows_text)

    # --- PPTX ---
    elif ext == "pptx":
        if Presentation is None:
            full_text = ""
            summary = "（伺服器未安裝 python-pptx，無法解析 pptx。請先 pip install python-pptx）"
            return full_text, summary

        prs = Presentation(str(path))
        texts: list[str] = []
        for si, slide in enumerate(prs.slides, start=1):
            slide_lines: list[str] = [f"[Slide {si}]"]
            for shape in slide.shapes:
                # 文字框
                if hasattr(shape, "text") and shape.text:
                    t = shape.text.strip()
                    if t:
                        slide_lines.append(t)
                # 表格
                if hasattr(shape, "has_table") and shape.has_table:
                    tbl = shape.table
                    for r in range(len(tbl.rows)):
                        row_cells = []
                        for c in range(len(tbl.columns)):
                            cell_text = (tbl.cell(r, c).text or "").strip()
                            if cell_text:
                                row_cells.append(cell_text)
                        if row_cells:
                            slide_lines.append("  ".join(row_cells))
            texts.append("\n".join(slide_lines))
        full_text = "\n\n".join(texts)

    # --- PPT（舊格式）---
    elif ext == "ppt":
        # 不炸，但也不硬做：舊 ppt 解析要額外工具，做了反而更不穩
        full_text = ""
        summary = "（.ppt 為舊格式，後端不做文字抽取。建議先另存成 .pptx 再上傳）"
        return full_text, summary

    else:
        full_text = ""

    summary = _summarize(full_text, max_chars=600)
    return full_text, summary
