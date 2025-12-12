# s2_agent/rag.py
from typing import Optional, List
from fastapi import APIRouter
from pydantic import BaseModel

from .service import rag_search

router = APIRouter(prefix="/s2/rag", tags=["S2 RAG"])


class RAGQuery(BaseModel):
    session_id: Optional[str] = None
    question: str
    bone_id: Optional[int] = None
    bone_small_id: Optional[int] = None
    top_k: int = 5


class SourceItem(BaseModel):
    material_id: Optional[str]
    title: Optional[str]
    type: Optional[str]
    language: Optional[str]
    file_path: Optional[str]
    page: Optional[int]
    score: float


class RAGResponse(BaseModel):
    answer: str
    sources: List[SourceItem]


@router.post("/query", response_model=RAGResponse)
async def rag_query(q: RAGQuery):
    answer, src = rag_search(
        question=q.question,
        bone_id=q.bone_id,
        bone_small_id=q.bone_small_id,
        top_k=q.top_k,
    )
    sources = [SourceItem(**s) for s in src]
    return RAGResponse(answer=answer, sources=sources)
