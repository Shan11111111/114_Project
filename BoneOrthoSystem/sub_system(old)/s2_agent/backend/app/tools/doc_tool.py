from pathlib import Path
from typing import Tuple

from PyPDF2 import PdfReader
import pdfplumber
from docx import Document
import openpyxl


def extract_text_and_summary(path: Path | str,
                             ext: str | None = None) -> Tuple[str, str]:
    """
    讀取檔案內容並產生簡單摘要。

    path: 檔案路徑
    ext : 副檔名（不含 .），例如 'pdf'、'pptx'、'txt'、'docx'、'xlsx'
          若為 None，則會從 path.suffix 自動判斷
    """
    if isinstance(path, str):
        path = Path(path)

    # 自動判斷副檔名
    if ext is None:
        ext = path.suffix.lower().lstrip(".")
    else:
        ext = ext.lower()

    full_text = ""

    # --- PDF ---
    if ext == "pdf":
        # 用 pdfplumber 抓文字；抓不到就退而求其次用 PyPDF2
        try:
            with pdfplumber.open(path) as pdf:
                texts = []
                for page in pdf.pages:
                    t = page.extract_text() or ""
                    texts.append(t)
                full_text = "\n".join(texts)
        except Exception:
            reader = PdfReader(str(path))
            texts = []
            for page in reader.pages:
                t = page.extract_text() or ""
                texts.append(t)
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
            for row in sheet.iter_rows(values_only=True):
                cells = ["" if v is None else str(v) for v in row]
                rows_text.append("  ".join(cells))
        full_text = "\n".join(rows_text)

    # --- 純文字 ---
    elif ext == "txt":
        full_text = path.read_text(encoding="utf-8", errors="ignore")

    # 不支援的類型
    else:
        full_text = ""

    # --- 簡單摘要：取前幾行 / 前幾百字 ---
    lines = [ln.strip() for ln in full_text.splitlines() if ln.strip()]
    joined = "\n".join(lines)
    # 限制長度，避免太長
    max_chars = 600
    summary = joined[:max_chars]

    return full_text, summary
