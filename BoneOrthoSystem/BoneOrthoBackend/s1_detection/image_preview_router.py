from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
import pyodbc
from pathlib import Path

router = APIRouter(prefix="/history", tags=["s1_history_image"])


def get_db_conn():
    return pyodbc.connect(
        "DRIVER={ODBC Driver 17 for SQL Server};"
        "SERVER=localhost;"
        "DATABASE=BoneDB;"
        "Trusted_Connection=yes;"
    )


def find_project_root(start: Path, target_name: str = "BoneOrthoSystem") -> Path:
    current = start.resolve()
    for parent in [current] + list(current.parents):
        if parent.name == target_name:
            return parent
    return start.resolve()


@router.get("/image/{bone_image_id}")
def preview_history_image(bone_image_id: int):
    conn = None
    try:
        conn = get_db_conn()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT image_id, image_name, image_path, content_type
            FROM dbo.Bone_Images
            WHERE image_id = ?
        """, bone_image_id)

        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="找不到圖片資料")

        image_path = row.image_path
        content_type = row.content_type or "application/octet-stream"
        image_name = row.image_name or f"{bone_image_id}.png"

        if not image_path:
            raise HTTPException(status_code=404, detail="image_path 為空")

        project_root = find_project_root(Path(__file__).resolve())
        file_path = project_root / image_path.lstrip("/\\")
        file_path = file_path.resolve()

        if not file_path.exists():
            raise HTTPException(status_code=404, detail=f"圖片檔不存在: {file_path}")

        return FileResponse(
            path=str(file_path),
            media_type=content_type,
            filename=image_name,
        )

    finally:
        if conn is not None:
            conn.close()