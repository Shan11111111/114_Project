# s2_agent/router.py
from typing import Optional, List
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from pydantic import BaseModel

from db import get_connection
from s2_agent.vectordb.ingest_materials import index_material
from .service import rag_search  # 等一下會用到

# 這個 router 本身就帶 prefix="/s2"
router = APIRouter(prefix="/s2", tags=["S2 Agent"])

# === 上傳教材 ===

MATERIAL_ROOT = Path(__file__).resolve().parent / "vectordb" / "materials"


class UploadMaterialResponse(BaseModel):
    material_id: int
    file_path: str


@router.post("/materials/upload", response_model=UploadMaterialResponse)
async def upload_material(
    file: UploadFile = File(...),
    title: str = Form(...),
    type: str = Form("pdf"),
    language: str = Form("zh-TW"),
    style: str = Form("edu"),
    bone_id: Optional[int] = Form(None),
    bone_detail_id: Optional[int] = Form(None),
    user_id: Optional[str] = Form("teacher01"),
):
    MATERIAL_ROOT.mkdir(parents=True, exist_ok=True)

    rel_path = file.filename  # 先簡單用檔名當 FilePath
    full_path = MATERIAL_ROOT / rel_path

    content = await file.read()
    with open(full_path, "wb") as f:
        f.write(content)

    sql = """
    INSERT INTO agent.TeachingMaterial
        (ConversationId, UserId, Type, Language, Style,
         Title, StructureJson, FilePath, CreatedAt, BoneId, BoneDetailId)
    OUTPUT INSERTED.MaterialId
    VALUES
        (NULL, ?, ?, ?, ?, ?, NULL, ?, SYSDATETIME(), ?, ?);
    """

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
            bone_detail_id,
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=500, detail="插入 TeachingMaterial 失敗")
        material_id = int(row[0])
        conn.commit()

    # 寫入向量庫
    try:
        index_material(material_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"向量庫索引失敗: {e}")

    return UploadMaterialResponse(material_id=material_id, file_path=rel_path)


# === RAG 查詢 ===

class RAGQuery(BaseModel):
    session_id: Optional[str] = None
    question: str
    bone_id: Optional[int] = None
    bone_detail_id: Optional[int] = None
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
        bone_detail_id=q.bone_detail_id,
        top_k=q.top_k,
    )
    sources = [SourceItem(**s) for s in src]
    return RAGResponse(answer=answer, sources=sources)
