from fastapi import APIRouter, UploadFile, File, HTTPException
from ..tools.file_tool import extract_file_text
from ..tools.rag_tool import answer_with_rag

# 可選：把檔案內容索引到文件型 RAG（預設不啟用）
try:
    from ..tools.doc_index import index_document
except Exception:
    index_document = None
from pathlib import Path
import uuid
import os

router = APIRouter(prefix="/upload", tags=["upload"])

BASE_DIR = Path(__file__).resolve().parent.parent.parent
UPLOAD_DIR = BASE_DIR / "data" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

@router.post("/file")
async def upload_and_process_file(file: UploadFile = File(...)):
    ext = (file.filename or "").split(".")[-1].lower()
    fname = f"{uuid.uuid4().hex}.{ext}"
    fpath = UPLOAD_DIR / fname

    # 儲存檔案
    data = await file.read()
    with open(fpath, "wb") as f:
        f.write(data)

    # 解析內容
    parsed_text = extract_file_text(str(fpath))

    # （可選）索引到文件型 RAG
    index_result = None
    if index_document is not None and os.getenv("S2_DOC_RAG_INDEX_ON_UPLOAD", "0") == "1":
        try:
            material_id = fname  # 用檔名當 material_id（夠用，且可追溯）
            index_result = index_document(
                material_id=material_id,
                title=(file.filename or fname),
                source_type=ext,
                text=parsed_text,
                extra_meta={"filename": fname},
            )
        except Exception as e:
            print("[upload_and_process_file] index_document error:", e)

    # 丟給 LLM 做摘要（你原本行為保留）
    question = f"請根據以下檔案內容產生摘要，並用條列式整理：\n\n{parsed_text}\n"
    ans, _ = answer_with_rag(question, {})

    return {
        "filename": fname,
        "parsed_text": parsed_text[:8000],
        "summary": ans,
        "index_result": index_result,
    }
