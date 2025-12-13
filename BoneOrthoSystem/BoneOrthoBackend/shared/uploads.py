# shared/uploads.py
from fastapi import APIRouter, UploadFile, File, HTTPException
from pathlib import Path
from uuid import uuid4

router = APIRouter(tags=["Shared Upload"])

UPLOAD_DIR = Path(__file__).resolve().parent / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

@router.post("/upload")
async def upload(file: UploadFile = File(...)):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty file")

    ext = Path(file.filename or "").suffix or ""
    name = f"{uuid4().hex}{ext}"
    path = UPLOAD_DIR / name
    path.write_bytes(data)

    # 回傳相對路徑，前端用 API_BASE 組成絕對 URL
    return {
        "url": f"/shared/uploads/{name}",
        "filetype": file.content_type,
        "filename": file.filename,
    }
