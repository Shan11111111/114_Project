# s2_agent/router.py
from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter()

class ChatMessage(BaseModel):
    role: str   # "user" / "assistant"
    content: str

class BoneChatRequest(BaseModel):
    userId: str
    imageCaseId: int
    detectionId: Optional[int] = None
    question: str

class BoneChatResponse(BaseModel):
    conversationId: int
    messages: List[ChatMessage]

@router.post("/chat/bone", response_model=BoneChatResponse)
async def chat_bone(req: BoneChatRequest):
    """
    S2：點骨頭後對 AI 提問。
    TODO:
      1) 用 detectionId / imageCaseId 查 BoneDB
      2) 查向量資料庫 / TeachingMaterial
      3) 呼叫 LLM 生成解說
      4) 寫入 agent.Conversation / ConversationMessage
    現在先回假資料，讓前端聊天室可先做 UI。
    """
    answer = (
        f"你選到的骨頭目前假設是鎖骨，imageCaseId={req.imageCaseId}, "
        f"detectionId={req.detectionId}。之後會在這裡接 RAG + LLM。"
    )

    return BoneChatResponse(
        conversationId=999,
        messages=[
            ChatMessage(role="user", content=req.question),
            ChatMessage(role="assistant", content=answer),
        ],
    )
