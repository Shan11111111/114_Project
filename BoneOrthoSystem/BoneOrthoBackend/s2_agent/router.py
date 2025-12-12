# s2_agent/router.py
from typing import Optional, List
from pathlib import Path
from uuid import uuid4
import traceback

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from pydantic import BaseModel

from db import get_connection
from s2_agent.vectordb.ingest_materials import index_material
from .service import rag_search

router = APIRouter(prefix="/s2", tags=["S2 Agent"])

MATERIAL_ROOT = Path(__file__).resolve().parent / "vectordb" / "materials"


class UploadMaterialResponse(BaseModel):
    material_id: int
    file_path: str


def _normalize_optional_int(v: Optional[int]) -> Optional[int]:
    """把 0 / 負數 當成未指定，回傳 None；正整數才保留。"""
    if v is None:
        return None
    try:
        v = int(v)
    except Exception:
        return None
    return v if v > 0 else None


@router.post("/materials/upload", response_model=UploadMaterialResponse)
async def upload_material(
    file: UploadFile = File(...),
    title: str = Form(...),
    type: str = Form("pdf"),
    language: str = Form("zh-TW"),
    style: str = Form("edu"),
    bone_id: Optional[int] = Form(None),
    bone_small_id: Optional[int] = Form(None),
    user_id: Optional[str] = Form("teacher01"),
):
    # 1) normalize：把 0 轉成 None，避免 DB FK / constraint 炸裂
    bone_id = _normalize_optional_int(bone_id)
    bone_small_id = _normalize_optional_int(bone_small_id)

    # 2) 確保資料夾存在
    MATERIAL_ROOT.mkdir(parents=True, exist_ok=True)

    # 3) 檔名安全化 + 唯一化（避免覆蓋、避免 ../ 穿越）
    original_name = Path(file.filename).name if file.filename else "upload.bin"
    unique_name = f"{uuid4().hex}_{original_name}"
    rel_path = unique_name
    full_path = MATERIAL_ROOT / rel_path

    # 4) 存檔（先存，再寫 DB；若 DB 失敗，會刪檔）
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

    # 5) 寫 DB
    sql = """
    INSERT INTO agent.TeachingMaterial
        (ConversationId, UserId, Type, Language, Style,
         Title, StructureJson, FilePath, CreatedAt, BoneId, BoneSmallId)
    OUTPUT INSERTED.MaterialId
    VALUES
        (NULL, ?, ?, ?, ?, ?, NULL, ?, SYSDATETIME(), ?, ?);
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
                rel_path,
                bone_id,
                bone_small_id,
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=500, detail="插入 TeachingMaterial 失敗（無回傳 MaterialId）")
            material_id = int(row[0])
            conn.commit()
    except HTTPException:
        # DB 失敗：清掉剛才寫入的檔案，避免孤兒檔
        try:
            if full_path.exists():
                full_path.unlink()
        except Exception:
            pass
        raise
    except Exception as e:
        # DB 失敗：清掉剛才寫入的檔案
        try:
            if full_path.exists():
                full_path.unlink()
        except Exception:
            pass
        # 回傳更有用的錯誤（先救 debug）
        raise HTTPException(status_code=500, detail=f"寫入 DB 失敗: {e}")

    # 6) 寫入向量庫（建議：索引失敗不要把 DB 也一起判死刑）
    try:
        index_material(material_id)
    except Exception as e:
        # 如果你想「索引失敗就整個 500」，就把下面這行解除註解，並刪掉 return
        # raise HTTPException(status_code=500, detail=f"向量庫索引失敗: {e}")

        # 保留成功上傳，但回傳警告（前端可以提示稍後再索引）
        # 你如果不想回傳 warning，也可以改成 print 就好
        print("⚠️ index_material failed:\n", traceback.format_exc())

    return UploadMaterialResponse(material_id=material_id, file_path=rel_path)


# === RAG 查詢 ===

class RAGQuery(BaseModel):
    session_id: Optional[str] = None
    question: str
    bone_id: Optional[int] = None
    bone_small_id: Optional[int] = None
    top_k: int = 5


class SourceItem(BaseModel):
    material_id: Optional[int]
    title: Optional[str]
    type: Optional[str]
    language: Optional[str]
    file_path: Optional[str]
    page: Optional[int]
    score: float


class RAGResponse(BaseModel):
    answer: str
    sources: List[SourceItem]


@router.post("/rag/query", response_model=RAGResponse)
async def rag_query(q: RAGQuery):
    answer, src = rag_search(
        question=q.question,
        bone_id=q.bone_id,
        bone_small_id=q.bone_small_id,
        top_k=q.top_k,
    )
    sources = [SourceItem(**s) for s in src]
    return RAGResponse(answer=answer, sources=sources)
