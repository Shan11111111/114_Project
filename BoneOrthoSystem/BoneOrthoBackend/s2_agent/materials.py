from typing import Optional
from pathlib import Path
from uuid import uuid4, UUID
import traceback
import os
import mimetypes

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query
from pydantic import BaseModel
from fastapi.responses import FileResponse

from db import get_connection
from s2_agent.vectordb.ingest_materials import index_material
from shared.vector_client import VectorStore

router = APIRouter(prefix="/s2/materials", tags=["S2 Materials"])

MATERIAL_ROOT = Path(__file__).resolve().parent / "vectordb" / "materials"


class UploadMaterialResponse(BaseModel):
    material_id: str
    file_path: str


def _norm_role(role: Optional[str]) -> str:
    return (role or "").strip().lower()


def _is_manager(role: Optional[str]) -> bool:
    return _norm_role(role) == "manager"


@router.post("/upload", response_model=UploadMaterialResponse)
async def upload_material(
    file: UploadFile = File(...),
    title: str = Form(...),
    type: str = Form("pdf"),
    language: str = Form("zh-TW"),
    style: str = Form("edu"),
    user_id: str = Form(...),
    conversation_id: Optional[UUID] = Form(None),
    structure_json: Optional[str] = Form(None),
):
    user_id = (user_id or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="請先登入，未登入不可上傳教材")

    structure_json = structure_json or "{}"
    MATERIAL_ROOT.mkdir(parents=True, exist_ok=True)

    original_name = Path(file.filename).name if file.filename else "upload.bin"
    unique_name = f"{uuid4().hex}_{original_name}"
    rel_path = unique_name
    full_path = MATERIAL_ROOT / rel_path

    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="上傳檔案是空的")
        with open(full_path, "wb") as f:
            f.write(content)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"檔案寫入失敗: {e}")

    sql = """
    INSERT INTO agent.TeachingMaterial
        (UserId, Type, Language, Style, Title, StructureJson, FilePath, CreatedAt)
    OUTPUT INSERTED.MaterialId
    VALUES
        (?, ?, ?, ?, ?, ?, ?, SYSDATETIME());
    """

    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                sql,
                user_id,
                type,
                language,
                style,
                title,
                structure_json,
                rel_path,
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(
                    status_code=500,
                    detail="插入 TeachingMaterial 失敗（無回傳 MaterialId）"
                )
            material_id = str(row[0])
            conn.commit()
    except HTTPException:
        if full_path.exists():
            try:
                full_path.unlink()
            except Exception:
                pass
        raise
    except Exception as e:
        if full_path.exists():
            try:
                full_path.unlink()
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=f"寫入 DB 失敗: {e}")

    try:
        index_material(material_id)
    except Exception:
        print("⚠️ index_material failed:\n", traceback.format_exc())

    return UploadMaterialResponse(material_id=material_id, file_path=rel_path)


@router.get("/list")
def list_materials(
    user_id: str = Query(...),
    role: str = Query("teacher"),
    q: str | None = Query(None),
    top: int = Query(200, ge=1, le=1000),
):
    user_id = (user_id or "").strip()
    role = _norm_role(role)

    if not user_id:
        raise HTTPException(status_code=401, detail="請先登入")

    if _is_manager(role):
        sql = """
        SELECT TOP (?) 
            MaterialId, UserId, Type, Language, Style, Title,
            FilePath, CreatedAt
        FROM agent.TeachingMaterial
        WHERE (
            ? IS NULL
            OR Title LIKE '%' + ? + '%'
            OR CONVERT(varchar(36), MaterialId) LIKE '%' + ? + '%'
            OR UserId LIKE '%' + ? + '%'
        )
        ORDER BY CreatedAt DESC;
        """
        params = (top, q, q, q, q)
    else:
        sql = """
        SELECT TOP (?) 
            MaterialId, UserId, Type, Language, Style, Title,
            FilePath, CreatedAt
        FROM agent.TeachingMaterial
        WHERE UserId = ?
          AND (
            ? IS NULL
            OR Title LIKE '%' + ? + '%'
            OR CONVERT(varchar(36), MaterialId) LIKE '%' + ? + '%'
          )
        ORDER BY CreatedAt DESC;
        """
        params = (top, user_id, q, q, q)

    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, *params)
        cols = [c[0] for c in cur.description]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]

    for r in rows:
        r["MaterialId"] = str(r.get("MaterialId"))
        if r.get("CreatedAt") is not None:
            r["CreatedAt"] = str(r["CreatedAt"])

    return {"materials": rows}


@router.get("/{material_id}/download")
def download_one(
    material_id: str,
    user_id: str = Query(...),
    role: str = Query("teacher"),
):
    user_id = (user_id or "").strip()
    role = _norm_role(role)

    if not user_id:
        raise HTTPException(status_code=401, detail="請先登入")

    if _is_manager(role):
        sql = """
        SELECT MaterialId, UserId, Title, FilePath, Type
        FROM agent.TeachingMaterial
        WHERE MaterialId = ?;
        """
        params = (material_id,)
    else:
        sql = """
        SELECT MaterialId, UserId, Title, FilePath, Type
        FROM agent.TeachingMaterial
        WHERE MaterialId = ? AND UserId = ?;
        """
        params = (material_id, user_id)

    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, *params)
        row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="找不到教材，或你沒有權限下載此檔案")

    material_id_db, owner_id, title, file_path, type_name = row
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


@router.post("/{material_id}/reindex")
def reindex_one(material_id: str):
    index_material(material_id)
    return {"material_id": material_id, "reindexed": True}


@router.delete("/{material_id}")
def delete_one(
    material_id: str,
    user_id: str = Query(...),
    role: str = Query("teacher"),
):
    user_id = (user_id or "").strip()
    role = _norm_role(role)

    if not user_id:
        raise HTTPException(status_code=401, detail="請先登入")

    if not _is_manager(role):
        raise HTTPException(status_code=403, detail="只有 manager 可以刪除教材")

    sql_sel = """
    SELECT FilePath
    FROM agent.TeachingMaterial
    WHERE MaterialId = ?;
    """
    sql_del = """
    DELETE FROM agent.TeachingMaterial
    WHERE MaterialId = ?;
    """

    file_path = None
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql_sel, material_id)
        row = cur.fetchone()
        if row:
            file_path = row[0]

        if not file_path:
            raise HTTPException(status_code=404, detail="教材不存在")

        cur.execute(sql_del, material_id)
        conn.commit()

    if file_path:
        p = MATERIAL_ROOT / str(file_path)
        if p.exists():
            try:
                p.unlink()
            except Exception:
                pass

    try:
        from qdrant_client.models import Filter, FieldCondition, MatchValue

        vs = VectorStore()
        vs.client.delete(
            collection_name=os.getenv("QDRANT_COLLECTION", "bone_edu_docs"),
            points_selector=Filter(
                must=[
                    FieldCondition(
                        key="material_id",
                        match=MatchValue(value=material_id)
                    )
                ]
            ),
        )
    except Exception:
        pass

    return {"material_id": material_id, "deleted": True}