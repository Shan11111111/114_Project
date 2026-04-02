# 2024-06-20: 新增llm頁面的教材下載與預覽功能
# llm_materials_router.py
from pathlib import Path
import mimetypes

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from db import get_connection

router = APIRouter(prefix="/s2/llm/materials", tags=["s2-llm-materials"])

# 跟你現在教材實體存放位置一致
MATERIAL_ROOT = Path(__file__).resolve().parent / "vectordb" / "materials"


@router.get("/{material_id}/download")
def llm_download_one(material_id: str):
    sql = """
    SELECT MaterialId, Title, FilePath, Type
    FROM agent.TeachingMaterial
    WHERE MaterialId = ?;
    """

    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, material_id)
        row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="找不到教材")

    material_id_db, title, file_path, type_name = row
    full_path = MATERIAL_ROOT / str(file_path)

    if not full_path.exists():
        raise HTTPException(status_code=404, detail="檔案不存在，可能已被移除")

    guessed_media_type, _ = mimetypes.guess_type(str(full_path))
    media_type = guessed_media_type or "application/octet-stream"

    original_name = Path(str(file_path)).name
    if "_" in original_name:
        safe_name = original_name.split("_", 1)[1]
    else:
        ext = full_path.suffix or ""
        safe_name = f"{title}{ext}"

    return FileResponse(
        path=str(full_path),
        media_type=media_type,
        filename=safe_name,
    )
    
@router.get("/{material_id}/view")
def llm_view_one(material_id: str):
    sql = """
    SELECT MaterialId, Title, FilePath, Type
    FROM agent.TeachingMaterial
    WHERE MaterialId = ?;
    """

    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, material_id)
        row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="找不到教材")

    material_id_db, title, file_path, type_name = row
    full_path = MATERIAL_ROOT / str(file_path)

    if not full_path.exists():
        raise HTTPException(status_code=404, detail="檔案不存在，可能已被移除")

    guessed_media_type, _ = mimetypes.guess_type(str(full_path))
    media_type = guessed_media_type or "application/octet-stream"

    # view 不強制下載，讓瀏覽器自己決定開啟
    return FileResponse(
        path=str(full_path),
        media_type=media_type,
    )