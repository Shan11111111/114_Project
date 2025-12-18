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

    # ✅ 新增：避免 main.py 取不到 req.user_id 造成 500
    # 前端沒送也沒關係，會是 "guest"
    user_id: str = "guest"

    messages: List[ChatMessage]


class ChatResponse(BaseModel):
    messages: List[ChatMessage]
    actions: List[Action] = []
