from typing import Literal, Optional, List
from pydantic import BaseModel


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    type: Literal["text", "image", "file"]
    content: Optional[str] = None      # 文字內容
    url: Optional[str] = None          # 圖片或檔案路徑 / URL
    filetype: Optional[str] = None     # pdf / pptx / png / jpg... 等


class Action(BaseModel):
    """給 Web / Unity 用的動作指令。"""
    type: str
    target_model: Optional[str] = None
    bones: Optional[List[str]] = None
    image_url: Optional[str] = None


class ChatRequest(BaseModel):
    session_id: str
    messages: List[ChatMessage]


class ChatResponse(BaseModel):
    messages: List[ChatMessage]
    actions: List[Action] = []
