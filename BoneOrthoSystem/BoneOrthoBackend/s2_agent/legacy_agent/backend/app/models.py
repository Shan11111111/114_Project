from __future__ import annotations

from typing import Literal, Optional, List, Any
from pydantic import BaseModel


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    type: Literal["text", "image", "file"]
    content: Optional[str] = None
    url: Optional[str] = None
    filetype: Optional[str] = None


class Action(BaseModel):
    """給 Web / Unity 用的動作指令（legacy 相容）。"""
    type: str
    target_model: Optional[str] = None
    bones: Optional[List[str]] = None
    image_url: Optional[str] = None
    sources: Optional[List[Any]] = None
    citations: Optional[List[Any]] = None
    items: Optional[List[Any]] = None


class ChatRequest(BaseModel):
    session_id: str
    user_id: str | None = None
    conversation_id: str | None = None
    messages: list[ChatMessage]

    # 新增：前端模式切換
    rag_mode: Literal["file_then_vector", "vector_only", "file_only", "pubmed_only"] = "file_then_vector"

    # 新增：PubMed 一次最多抓幾篇
    pubmed_max_results: int = 5


class ChatResponse(BaseModel):
    messages: list[ChatMessage]
    actions: list[Action] = []
    session_id: str | None = None
    conversation_id: str | None = None
    answer: str | None = None