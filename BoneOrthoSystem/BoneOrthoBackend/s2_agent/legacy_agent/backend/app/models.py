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

    # ✅ 新增：有些版本會塞 sources/citations/items
    sources: Optional[List[Any]] = None
    citations: Optional[List[Any]] = None
    items: Optional[List[Any]] = None


class ChatRequest(BaseModel):
    session_id: str
    user_id: str | None = None
    conversation_id: str | None = None   
    messages: list[ChatMessage]



class ChatResponse(BaseModel):
    messages: list[ChatMessage]
    actions: list[Action] = []
    session_id: str | None = None         # ✅ 新增（回給前端）
    conversation_id: str | None = None    # ✅ 新增（回給前端）
    answer: str | None = None             # 可選：你前端會吃 answer/content/message
