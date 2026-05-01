# 這裡定義了 ChatMessage、Action、ChatRequest、ChatResponse 四個 Pydantic 模型，用於定義聊天訊息、動作指令、聊天請求和聊天回應的結構。
# models.py
from __future__ import annotations

from typing import Literal, Optional, List, Any
from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    type: Literal["text", "image", "file"]
    content: Optional[str] = None
    url: Optional[str] = None
    filetype: Optional[str] = None


class ChatResource(BaseModel):
    title: str
    url: Optional[str] = None
    download_url: Optional[str] = None
    source_type: Optional[str] = None
    page: Optional[str] = None
    snippet: Optional[str] = None


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

    # 前端語言設定
    # locale：目前 UI 語言
    # response_language：希望 AI 回答的語言
    locale: str | None = None
    response_language: str | None = None

    # 前端模式切換
    rag_mode: Literal[
        "file_then_vector",
        "vector_only",
        "file_only",
        "pubmed_only",
        "soap_only",
        "auto_fusion",
    ] = "file_then_vector"

    # PubMed 一次最多抓幾篇
    pubmed_max_results: int = 5


class ChatResponse(BaseModel):
    messages: list[ChatMessage]
    actions: list[Action] = Field(default_factory=list)
    session_id: str | None = None
    conversation_id: str | None = None
    answer: str | None = None
    resources: list[ChatResource] = Field(default_factory=list)