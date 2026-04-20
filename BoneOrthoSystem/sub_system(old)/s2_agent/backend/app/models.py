from typing import Literal, Optional, List
from pydantic import BaseModel


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    type: Literal["text", "image", "file"]
    content: Optional[str] = None
    url: Optional[str] = None
    filetype: Optional[str] = None


class Action(BaseModel):
    """給 Web / Unity 用的動作指令。"""
    type: str
    target_model: Optional[str] = None
    bones: Optional[List[str]] = None
    image_url: Optional[str] = None


class ChatRequest(BaseModel):
    session_id: str
    user_id: Optional[str] = None
    conversation_id: Optional[str] = None
    privacy_consent: bool = False
    pii_mode: Literal["block", "mask"] = "block"
    messages: List[ChatMessage]


class ChatResponse(BaseModel):
    messages: List[ChatMessage]
    actions: List[Action] = []