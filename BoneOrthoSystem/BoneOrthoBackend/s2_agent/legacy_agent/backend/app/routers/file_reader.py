from fastapi import APIRouter, UploadFile, File, HTTPException
from ..tools.file_tool import extract_file_text
from ..tools.rag_tool import answer_with_rag
from pathlib import Path
import uuid

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

    # 丟給 LLM 做摘要
    question = f"請根據以下檔案內容產生摘要，並用條列式整理：\n\n{parsed_text}\n"
    ans, _ = answer_with_rag(question, {})

    return {
        "filename": fname,
        "parsed_text": parsed_text[:8000],
        "summary": ans,
    }
