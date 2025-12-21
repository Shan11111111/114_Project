# s2_agent/api_router.py
from fastapi import APIRouter

from s2_agent.legacy_agent.backend.app.routers.export import export_pdf as legacy_export_pdf
from s2_agent.legacy_agent.backend.app.routers.export import export_pptx as legacy_export_pptx
from s2_agent.legacy_agent.backend.app.models import ChatRequest  # 如果路徑不對就按你的實際位置調整


router = APIRouter(prefix="/s2", tags=["S2 Agent Unified"])

# 對話 / 聊天室管理
@router.get("/health")
async def s2_health():
    # 先簡單 return，未來要的話可改呼叫 legacy 或 DB
    return {"status": "ok", "module": "s2-agent"}

@router.get("/conversations")
async def list_conversations(user_id: str):
    # TODO: 之後可改呼叫 legacy_agent 的 list_conversations
    return {"conversations": []}

@router.post("/conversations")
async def create_conversation():
    # TODO: call legacy create_conversation
    return {"conversation_id": "TODO"}

@router.get("/conversations/{conversation_id}/messages")
async def get_conversation_messages(conversation_id: str):
    return {"messages": []}

@router.post("/chat")
async def chat():
    # 這個將來要整合：LLM + 向量DB RAG + 寫 DB
    return {"messages": [], "actions": []}

@router.patch("/conversations/{conversation_id}/title")
async def update_conversation_title(conversation_id: str):
    return {"conversation_id": conversation_id, "title": "TODO"}

@router.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    return {"conversation_id": conversation_id, "deleted": True}


# 教材檔案與 RAG
@router.post("/files/upload")
async def upload_material_file():
    return {"file_id": "TODO"}

@router.get("/files")
async def list_files():
    return {"files": []}

@router.get("/files/{file_id}")
async def get_file(file_id: str):
    return {"file_id": file_id}

@router.post("/rag/query")
async def rag_query():
    # 可以直接呼叫你現在的 s2_agent/rag.py 的 rag_query
    return {"answer": "TODO", "sources": []}


# 骨頭資料與 YOLO 結合
@router.get("/bones/{bone_id}")
async def get_bone(bone_id: int):
    return {"bone_id": bone_id}

@router.get("/bones/{bone_id}/images/thumbnail")
async def get_bone_thumbnail(bone_id: int):
    return {"bone_id": bone_id, "image_url": "TODO"}

@router.post("/yolo/explain-bone")
async def yolo_explain_bone():
    return {"answer": "TODO"}


# 匯出報告
# 匯出報告（✅ 改成真的回檔案，不再回 TODO JSON）
@router.post("/export/pdf")
def export_pdf(req: ChatRequest):
    return legacy_export_pdf(req)

@router.post("/export/ppt")
def export_ppt(req: ChatRequest):
    # 這裡雖然 endpoint 叫 /ppt，但實際用 legacy 的 export_pptx 產 .pptx
    return legacy_export_pptx(req)
