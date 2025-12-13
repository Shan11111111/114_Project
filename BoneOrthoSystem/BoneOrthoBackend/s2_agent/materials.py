# s2_agent/materials.py
from typing import Optional
from pathlib import Path
from uuid import uuid4, UUID
import traceback

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from pydantic import BaseModel

from db import get_connection
from s2_agent.vectordb.ingest_materials import index_material

router = APIRouter(prefix="/s2/materials", tags=["S2 Materials"])

MATERIAL_ROOT = Path(__file__).resolve().parent / "vectordb" / "materials"


class UploadMaterialResponse(BaseModel):
    material_id: str
    file_path: str


def _normalize_optional_int(v: Optional[int]) -> Optional[int]:
    if v is None:
        return None
    try:
        v = int(v)
    except Exception:
        return None
    return v if v > 0 else None


@router.post("/upload", response_model=UploadMaterialResponse)
async def upload_material(
    file: UploadFile = File(...),
    title: str = Form(...),
    type: str = Form("pdf"),
    language: str = Form("zh-TW"),
    style: str = Form("edu"),
    bone_id: Optional[int] = Form(None),
    bone_small_id: Optional[int] = Form(None),     # ✅ 對外統一叫 bone_small_id
    user_id: Optional[str] = Form("teacher01"),
    conversation_id: Optional[UUID] = Form(None),
    structure_json: Optional[str] = Form(None),
):
    bone_id = _normalize_optional_int(bone_id)
    bone_small_id = _normalize_optional_int(bone_small_id)
    structure_json = structure_json or "{}"

    MATERIAL_ROOT.mkdir(parents=True, exist_ok=True)

    original_name = Path(file.filename).name if file.filename else "upload.bin"
    unique_name = f"{uuid4().hex}_{original_name}"
    rel_path = unique_name
    full_path = MATERIAL_ROOT / rel_path

    # save file
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
        (ConversationId, UserId, Type, Language, Style,
         Title, StructureJson, FilePath, CreatedAt, BoneId, BoneSmallId)
    OUTPUT INSERTED.MaterialId
    VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, SYSDATETIME(), ?, ?);
    """

    conv_val = str(conversation_id) if conversation_id else None

    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                sql,
                conv_val,
                user_id,
                type,
                language,
                style,
                title,
                structure_json,
                rel_path,
                bone_id,
                bone_small_id,
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=500, detail="插入 TeachingMaterial 失敗（無回傳 MaterialId）")
            material_id = str(row[0])
            conn.commit()
    except HTTPException:
        if full_path.exists():
            try: full_path.unlink()
            except Exception: pass
        raise
    except Exception as e:
        if full_path.exists():
            try: full_path.unlink()
            except Exception: pass
        raise HTTPException(status_code=500, detail=f"寫入 DB 失敗: {e}")

    # index to vectordb (fail-safe)
    try:
        index_material(material_id)
    except Exception:
        print("⚠️ index_material failed:\n", traceback.format_exc())

    return UploadMaterialResponse(material_id=material_id, file_path=rel_path)

from fastapi import Query
from shared.vector_client import VectorStore
from fastapi.responses import FileResponse
from fastapi import Query

@router.get("/list")
def list_materials(
    user_id: str = Query("teacher01"),
    q: str | None = Query(None),
    top: int = Query(200, ge=1, le=1000),
):
    sql = """
    SELECT TOP (?) 
        MaterialId, UserId, Type, Language, Style, Title,
        FilePath, CreatedAt, BoneId, BoneSmallId
    FROM agent.TeachingMaterial
    WHERE UserId = ?
      AND (
        ? IS NULL
        OR Title LIKE '%' + ? + '%'
        OR CONVERT(varchar(36), MaterialId) LIKE '%' + ? + '%'
      )
    ORDER BY CreatedAt DESC;
    """

    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, top, user_id, q, q, q)
        cols = [c[0] for c in cur.description]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]

    # 確保 GUID/時間可序列化
    for r in rows:
        r["MaterialId"] = str(r.get("MaterialId"))
        if r.get("CreatedAt") is not None:
            r["CreatedAt"] = str(r["CreatedAt"])

    return {"materials": rows}


@router.post("/{material_id}/reindex")
def reindex_one(material_id: str):
    index_material(material_id)
    return {"material_id": material_id, "reindexed": True}

@router.delete("/{material_id}")
def delete_one(material_id: str):
    # 1) 先拿檔名（用來刪檔）
    sql_sel = "SELECT FilePath FROM agent.TeachingMaterial WHERE MaterialId = ?;"
    sql_del = "DELETE FROM agent.TeachingMaterial WHERE MaterialId = ?;"

    file_path = None
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql_sel, material_id)
        row = cur.fetchone()
        if row:
            file_path = row[0]
        cur.execute(sql_del, material_id)
        conn.commit()

    # 2) 刪檔（如果存在）
    if file_path:
        p = (MATERIAL_ROOT / str(file_path))
        if p.exists():
            try:
                p.unlink()
            except Exception:
                pass

    # 3) 向量庫刪掉該 material 的 points（避免殘留）
    try:
        vs = VectorStore()
        # 這段用 qdrant 的 filter delete
        from qdrant_client.models import Filter, FieldCondition, MatchValue
        vs.client.delete(
            collection_name=os.getenv("QDRANT_COLLECTION", "bone_edu_docs"),
            points_selector=Filter(
                must=[FieldCondition(key="material_id", match=MatchValue(value=material_id))]
            ),
        )
    except Exception:
        pass

    return {"material_id": material_id, "deleted": True}
