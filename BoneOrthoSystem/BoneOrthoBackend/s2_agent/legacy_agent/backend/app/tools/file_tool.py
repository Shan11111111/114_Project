# BoneOrthoBackend/s2_agent/legacy_agent/backend/app/tools/file_tool.py
import os
import pdfplumber
import docx
from pptx import Presentation
import pandas as pd

def extract_text_from_pdf(path):
    text = ""
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text += page.extract_text() + "\n"
    return text

def extract_text_from_docx(path):
    doc = docx.Document(path)
    return "\n".join([p.text for p in doc.paragraphs])

def extract_text_from_pptx(path):
    prs = Presentation(path)
    text = ""
    for slide in prs.slides:
        for shape in slide.shapes:
            if hasattr(shape, "text"):
                text += shape.text + "\n"
    return text

def extract_text_from_xlsx(path):
    df = pd.read_excel(path)
    return df.to_string()

def extract_text_from_txt(path):
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()

def extract_file_text(path: str):
    ext = path.lower().split(".")[-1]

    if ext == "pdf":
        return extract_text_from_pdf(path)
    elif ext == "docx":
        return extract_text_from_docx(path)
    elif ext == "pptx":
        return extract_text_from_pptx(path)
    elif ext in ["xlsx", "xls"]:
        return extract_text_from_xlsx(path)
    elif ext == "txt":
        return extract_text_from_txt(path)
    else:
        return "（此檔案格式目前不支援文字解析）"
