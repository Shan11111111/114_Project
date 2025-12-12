# ai_agent_backend/app/main.py
from pathlib import Path
import uuid
import sys
import json

from fastapi import FastAPI, UploadFile, File, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from dotenv import load_dotenv
from pydantic import BaseModel

from .models import ChatRequest, ChatResponse, ChatMessage, Action
from .state.sessions import get_session, append_messages
from .tools.rag_tool import answer_with_rag
from .tools.yolo_tool import analyze_image
from .tools.doc_tool import extract_text_and_summary
from .routers.export import router as export_router

# ---------------------------------------------------------
# 路徑設定：把專案根目錄（Bone）加進 sys.path，才能 import db
# ---------------------------------------------------------
APP_DIR = Path(__file__).resolve().parent        # ...\Bone\ai_agent_backend\app
BACKEND_DIR = APP_DIR.parent                     # ...\Bone\ai_agent_backend
PROJECT_ROOT = BACKEND_DIR.parent                # ...\Bone

if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

# 從 Bone/db.py 匯入 DB 函式
from db import (
    get_connection,
    create_conversation,
    add_message,
    list_conversations,
    get_messages,
    update_conversation_title,
    set_conversation_title_if_empty,
    delete_conversation,         # ← 新增：刪除用
)

load_dotenv(PROJECT_ROOT / ".env")

FRONTEND_DIR = BACKEND_DIR / "frontend"
UPLOAD_DIR = BACKEND_DIR / "data" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Bone AI Agent")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 前端頁面
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")

# 上傳檔案靜態服務
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

# 匯出 PDF/PPTX router
app.include_router(export_router)

# =========================================================
# 工具：把 ChatMessage 存進 DB
# =========================================================
def add_message_to_db_from_chatmessage(conversation_id: str, msg: ChatMessage):
    """
    把 ChatMessage 物件存到 agent.ConversationMessage。
    - 文字：寫 content
    - 圖片：url / filetype 存在 AttachmentsJson
    """
    attachments_json = None
    if msg.type == "image" and msg.url:
        attachments_json = json.dumps(
            {
                "url": msg.url,
                "filetype": msg.filetype,
            },
            ensure_ascii=False,
        )

    add_message(
        conversation_id=conversation_id,
        role=msg.role,
        content=msg.content or "",
        attachments_json=attachments_json,
        meta_json=None,
    )

# =========================================================
# 健康檢查
# =========================================================
@app.get("/health")
def health():
    """
    健康檢查：順便測試 DB 有沒有接到 BoneDB。
    """
    try:
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            row = cursor.fetchone()
        return {"status": "ok", "db": row[0]}
    except Exception as e:
        return {"status": "error", "detail": str(e)}

# =========================================================
# 通用上傳端點
# =========================================================
@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """
    通用上傳端點：
    - 圖片：只存檔，交由前端再呼叫 /agent/chat 觸發 YOLO
    - 文件：讀內容 + 做摘要，交由前端顯示，並再送一則「摘要訊息」給 /agent/chat
    """
    ext = (file.filename or "").split(".")[-1].lower()
    fname = f"{uuid.uuid4().hex}.{ext}"
    fpath = UPLOAD_DIR / fname

    data = await file.read()
    with open(fpath, "wb") as f:
        f.write(data)

    file_url = f"/uploads/{fname}"
    result = {
        "url": file_url,
        "filetype": ext,
        "filename": file.filename,
    }

    if ext in {"pdf", "pptx", "txt", "docx", "xlsx", "xls"}:
        text, summary = extract_text_and_summary(fpath, ext)
        result["text"] = text
        result["summary"] = summary

    return result

# =========================================================
# 主要聊天端點：YOLO + RAG
# 這裡把 session_id 當成 ConversationId
# =========================================================
@app.post("/agent/chat", response_model=ChatResponse)
def agent_chat(req: ChatRequest):
    """
    - user + image → YOLO + 回傳標記圖 & 說明，同時寫入 DB
    - user + text  → RAG 回答，同時寫入 DB
    - assistant + text（例如檔案摘要）→ 只寫進 session / DB，不另外回覆
    """
    if not req.session_id:
        raise HTTPException(status_code=400, detail="session_id (conversationId) is required")

    conversation_id = req.session_id

    # in-memory session：用 ConversationId 當 key
    session = get_session(conversation_id)
    append_messages(session, req.messages)

    # 先把「前端送進來的所有訊息」寫進 DB
    for msg in req.messages:
        add_message_to_db_from_chatmessage(conversation_id, msg)

    last = req.messages[-1]
    actions: list[Action] = []

    # ========== 圖片 YOLO ==========
    if last.type == "image" and last.role == "user":
        session["current_image_url"] = last.url
        if last.url:
            yolo_res = analyze_image(last.url)
            boxed_url = yolo_res["boxed_url"]
            dets = yolo_res["detections"]

            labels = ", ".join(d["bone"] for d in dets)
            explain = (
                f"Dr.Bone：偵測到的骨頭為 {labels}"
                if labels
                else "Dr.Bone：這張圖未偵測到特定骨頭。"
            )

            img_msg = ChatMessage(role="assistant", type="image", url=boxed_url)
            txt_msg = ChatMessage(role="assistant", type="text", content=explain)

            # 存進 session
            session["messages"].append(img_msg)
            session["messages"].append(txt_msg)

            # 同步寫進 DB
            add_message_to_db_from_chatmessage(conversation_id, img_msg)
            add_message_to_db_from_chatmessage(conversation_id, txt_msg)

            bones = [d["bone"] for d in dets]
            if bones:
                actions.append(
                    Action(
                        type="highlight_bones",
                        target_model=session.get("current_model_id"),
                        bones=bones,
                        image_url=boxed_url,
                    )
                )

    # ========== 文字 RAG ==========
    elif last.type == "text" and last.role == "user":
        user_q = last.content or ""
        ans_text, extras = answer_with_rag(user_q, session)

        # 文字回答
        reply = ChatMessage(role="assistant", type="text", content=ans_text)
        session["messages"].append(reply)
        add_message_to_db_from_chatmessage(conversation_id, reply)

        # 若 RAG 有回傳骨頭圖片 → 加一則圖片訊息
        for extra in extras or []:
            if extra.get("type") == "bone_image" and extra.get("image_url"):
                img_msg = ChatMessage(
                    role="assistant",
                    type="image",
                    content=None,
                    url=extra["image_url"],
                    filetype="png",   # 先固定 png，之後有需要再從 DB 帶 content_type
                )
                session["messages"].append(img_msg)
                add_message_to_db_from_chatmessage(conversation_id, img_msg)

        # 後端也可以在第一句時，幫你自動補標題（如果你想用的話）
        set_conversation_title_if_empty(conversation_id, user_q)

    # assistant 的文字（例如前端顯示檔案摘要）：
    # 上面已經寫進 DB 了，這裡不用再回覆一次

    return ChatResponse(messages=session["messages"], actions=actions)

# =========================================================
# 聊天室清單 & 歷史訊息 API
# =========================================================

class ConversationCreate(BaseModel):
    user_id: str
    title: str | None = None

@app.get("/agent/conversations")
def api_list_conversations(user_id: str = Query(..., alias="user_id")):
    """
    依 user_id 抓聊天室清單，給前端左邊列表用。
    回傳格式：{"conversations": [...]}
    """
    convs = list_conversations(user_id)
    return {"conversations": convs}

class ConversationTitleUpdate(BaseModel):
    title: str

@app.patch("/agent/conversations/{conversation_id}/title")
def api_update_conversation_title(conversation_id: str, payload: ConversationTitleUpdate):
    """把某個聊天室的標題改掉（自動命名用）"""
    new_title = payload.title.strip()
    if not new_title:
        raise HTTPException(status_code=400, detail="title cannot be empty")
    update_conversation_title(conversation_id, new_title)
    return {"conversation_id": conversation_id, "title": new_title}

@app.post("/agent/conversations")
def api_create_conversation(payload: ConversationCreate):
    """
    新增一個聊天室，回傳 ConversationId + Title
    user_id：可以用前端輸入框的「使用者 ID」
    """
    conv_id = create_conversation(payload.user_id, payload.title, source="S2")
    title = payload.title or "新的對話"
    return {"conversation_id": conv_id, "title": title}

@app.get("/agent/conversations/{conversation_id}/messages", response_model=ChatResponse)
def api_get_conversation_messages(conversation_id: str):
    """
    點選左側某個聊天室 → 載入歷史訊息
    """
    rows = get_messages(conversation_id)

    messages: list[ChatMessage] = []

    for r in rows:
        role = r["role"]
        content = r["content"]
        attachments_json = r["attachments_json"]

        msg_type = "text"
        url = None
        filetype = None

        if attachments_json:
            try:
                att = json.loads(attachments_json)
                url = att.get("url")
                filetype = att.get("filetype")
                if url:
                    msg_type = "image"
            except Exception:
                pass

        if msg_type == "image":
            m = ChatMessage(
                role=role,
                type="image",
                content=None,
                url=url,
                filetype=filetype,
            )
        else:
            m = ChatMessage(
                role=role,
                type="text",
                content=content,
                url=None,
                filetype=None,
            )

        messages.append(m)

    # 同步到 in-memory session，之後 /agent/chat 就有上下文可以用
    session = get_session(conversation_id)
    session["messages"] = messages

    return ChatResponse(messages=messages, actions=[])

# =========================================================
# 刪除聊天室 API
# =========================================================
@app.delete("/agent/conversations/{conversation_id}")
def api_delete_conversation(conversation_id: str):
    """
    刪除一個聊天室以及底下所有訊息。
    前端可以呼叫後，自己把左邊列表那一項移除。
    """
    delete_conversation(conversation_id)
    return {"conversation_id": conversation_id, "deleted": True}

# =========================================================
# 依 bone_id 取圖片（給 RAG 用）
# =========================================================
@app.get("/bones/{bone_id}/image")
def api_get_bone_image(bone_id: int):
    """
    從 dbo.Bone_Images 取出某個 bone_id 對應的一張圖片。
    優先用 image_data（varbinary），如果是 NULL 才嘗試用 image_path 找檔案。
    """
    sql = """
        SELECT TOP 1 image_path, content_type, image_data
        FROM dbo.Bone_Images
        WHERE bone_id = ?
        ORDER BY image_id
    """
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, bone_id)
        row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="image not found")

    image_path, content_type, image_data = row[0], row[1], row[2]
    media_type = content_type or "image/png"

    # 1) DB 有存二進位 → 直接回傳
    if image_data is not None:
        return Response(content=bytes(image_data), media_type=media_type)

    # 2) 沒有二進位 → 用 image_path 找檔案（如果真的有存檔）
    if image_path:
        rel = str(image_path).lstrip("/")  # 例如 "static/uploads/xx.png"
        file_path = BACKEND_DIR / rel
        if file_path.exists():
            with open(file_path, "rb") as f:
                data = f.read()
            return Response(content=data, media_type=media_type)

    # 都找不到
    raise HTTPException(status_code=404, detail="image file not found")
