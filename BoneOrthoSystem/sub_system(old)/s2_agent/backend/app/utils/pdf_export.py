
from __future__ import annotations

from io import BytesIO
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas


def build_pdf(report_title: str, summary_text: str) -> bytes:
    """
    傳入報告標題 + 一整段摘要文字，輸出 PDF bytes。
    """
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    width, height = A4

    y = height - 50
    c.setFont("Helvetica-Bold", 16)
    c.drawString(50, y, report_title or "骨科助理報告")
    y -= 40

    c.setFont("Helvetica", 11)

    # 簡單換行分段
    for line in summary_text.split("\n"):
        for chunk in _wrap_line(line, 80):
            if y < 80:
                c.showPage()
                y = height - 50
                c.setFont("Helvetica", 11)
            c.drawString(50, y, chunk)
            y -= 18

    c.showPage()
    c.save()
    pdf_bytes = buf.getvalue()
    buf.close()
    return pdf_bytes


def _wrap_line(text: str, max_len: int):
    text = text or ""
    while len(text) > max_len:
        yield text[:max_len]
        text = text[max_len:]
    if text:
        yield text