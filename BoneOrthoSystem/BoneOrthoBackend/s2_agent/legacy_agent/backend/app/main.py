# BoneOrthoBackend/s2_agent/legacy_agent/backend/app/main.py
from __future__ import annotations

import json
import sys
import uuid
from pathlib import Path
from typing import List

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .models import ChatRequest, ChatResponse, ChatMessage, Action
from .state.sessions import get_session, append_messages
from .tools.rag_tool import answer_with_rag
from .tools.yolo_tool import analyze_image
from .tools.doc_tool import extract_text_and_summary
from .routers.export import router as export_router


# =========================================================
# 找到 BoneOrthoBackend 專案根目錄（有 db.py 的那層）
# =========================================================
def _find_project_root() -> Path:
    p = Path(__file__).resolve()
    for _ in range(12):
        if (p / "db.py").exists():
            return p
        p = p.parent
    # 理論上不會到這裡；保底
    return Path(__file__).resolve().parents[4]


PROJECT_ROOT = _find_project_root()

# 確保可以 import 到專案根目錄的 db.py
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

# 載入 .env（放在 BoneOrthoBackend/.env）
load_dotenv(PROJECT_ROOT / ".env")

# DB functions
from db import (  # noqa: E402
    get_connection,
    create_conversation,
    add_message,
    list_conversations,
    get_messages,
    update_conversation_title,
    set_conversation_title_if_empty,
    delete_conversation,
)

# 你的 uploads 目錄（要跟 yolo_tool.py 一致）
UPLOAD_DIR = PROJECT_ROOT / "data" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="S2 Legacy Agent (Integrated)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 上傳檔案靜態服務
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

# 匯出 PDF/PPTX router
app.include_router(export_router)


# =========================================================
# 工具：把 ChatMessage 存進 DB
# =========================================================
def add_message_to_db_from_chatmessage(
    conversation_id: str,
    msg: ChatMessage,
    sources: list[dict] | None = None,
):
    """
    - image: 存 AttachmentsJson
    - text : 存 Content
    - sources: 存到 MetaJson（db.py add_message 會包進 meta）
    """
    attachments_json = None

    if msg.type == "image" and msg.url:
        attachments_json = json.dumps(
            {"url": msg.url, "filetype": msg.filetype},
            ensure_ascii=False,
        )

    # ✅ 不要再傳 meta_json 這種不存在/不相容參數
    add_message(
        conversation_id=conversation_id,  # db.py 會自動把 demo/session -> GUID
        role=msg.role,
        content=msg.content or "",
        attachments_json=attachments_json,
        sources=sources,
    )


# =========================================================
# 健康檢查
# =========================================================
@app.get("/health")
def health():
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT 1")
            row = cur.fetchone()
        return {"status": "ok", "db": row[0]}
    except Exception as e:
        return {"status": "error", "detail": str(e)}


# =========================================================
# 通用上傳端點
# =========================================================
@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    ext = (file.filename or "").split(".")[-1].lower()
    fname = f"{uuid.uuid4().hex}.{ext}"
    fpath = UPLOAD_DIR / fname

    data = await file.read()
    with open(fpath, "wb") as f:
        f.write(data)

    file_url = f"/uploads/{fname}"
    result = {"url": file_url, "filetype": ext, "filename": file.filename}

    if ext in {"pdf", "pptx", "txt", "docx", "xlsx", "xls"}:
        text, summary = extract_text_and_summary(fpath, ext)
        result["text"] = text
        result["summary"] = summary

    return result


# =========================================================
# 主要聊天端點：YOLO + RAG
# =========================================================
@app.post("/agent/chat", response_model=ChatResponse)
def agent_chat(req: ChatRequest):
    if not req.session_id:
        raise HTTPException(status_code=400, detail="session_id is required")

    conversation_id = req.session_id

    # session（記憶體）
    session = get_session(conversation_id)
    append_messages(session, req.messages)

    # 先把前端傳進來的訊息全部寫入 DB
    for msg in req.messages:
        add_message_to_db_from_chatmessage(conversation_id, msg)

    last = req.messages[-1]
    actions: list[Action] = []

    # ========== 圖片 YOLO ==========
    if last.type == "image" and last.role == "user":
        session["current_image_url"] = last.url

        if last.url:
            yolo_res = analyze_image(last.url)
            boxed_url = yolo_res.get("boxed_url")
            dets = yolo_res.get("detections") or []

            labels = ", ".join(d.get("bone", "") for d in dets if d.get("bone"))
            explain = (
                f"Dr.Bone：偵測到的骨頭為 {labels}"
                if labels
                else "Dr.Bone：這張圖未偵測到特定骨頭。"
            )

            img_msg = ChatMessage(role="assistant", type="image", url=boxed_url)
            txt_msg = ChatMessage(role="assistant", type="text", content=explain)

            session["messages"].append(img_msg)
            session["messages"].append(txt_msg)

            add_message_to_db_from_chatmessage(conversation_id, img_msg)
            add_message_to_db_from_chatmessage(conversation_id, txt_msg)

            bones = [d.get("bone") for d in dets if d.get("bone")]
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

        # ✅ 這裡回傳的第二個值當 sources（存 MetaJson）
        ans_text, sources = answer_with_rag(user_q, session)

        reply = ChatMessage(role="assistant", type="text", content=ans_text)
        session["messages"].append(reply)

        add_message_to_db_from_chatmessage(conversation_id, reply, sources=sources)

        # 自動補 title（如果 DB 裡是空的）
        set_conversation_title_if_empty(conversation_id, user_q)

    return ChatResponse(messages=session["messages"], actions=actions)


# =========================================================
# 聊天室清單 & 歷史訊息 API
# =========================================================
class ConversationCreate(BaseModel):
    user_id: str
    title: str | None = None


@app.get("/agent/conversations")
def api_list_conversations(user_id: str = Query(..., alias="user_id")):
    convs = list_conversations(user_id)
    return {"conversations": convs}


class ConversationTitleUpdate(BaseModel):
    title: str


@app.patch("/agent/conversations/{conversation_id}/title")
def api_update_conversation_title(conversation_id: str, payload: ConversationTitleUpdate):
    new_title = payload.title.strip()
    if not new_title:
        raise HTTPException(status_code=400, detail="title cannot be empty")
    update_conversation_title(conversation_id, new_title)
    return {"conversation_id": conversation_id, "title": new_title}


@app.post("/agent/conversations")
def api_create_conversation(payload: ConversationCreate):
    # ✅ 不要再塞 source="S2"（db.py create_conversation 沒收）
    conv_id = create_conversation(payload.user_id, payload.title)
    title = payload.title or "新的對話"
    return {"conversation_id": conv_id, "title": title}


@app.get("/agent/conversations/{conversation_id}/messages", response_model=ChatResponse)
def api_get_conversation_messages(conversation_id: str):
    rows = get_messages(conversation_id)

    messages: list[ChatMessage] = []

    for r in rows:
        # ✅ 大小寫/命名防呆
        role = r.get("role") or r.get("Role")
        content = r.get("content") or r.get("Content")
        attachments_json = (
            r.get("attachments_json")
            or r.get("AttachmentsJson")
            or r.get("attachments")
        )

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
            m = ChatMessage(role=role, type="image", content=None, url=url, filetype=filetype)
        else:
            m = ChatMessage(role=role, type="text", content=content, url=None, filetype=None)

        messages.append(m)

    # 同步到 session
    session = get_session(conversation_id)
    session["messages"] = messages

    return ChatResponse(messages=messages, actions=[])


@app.delete("/agent/conversations/{conversation_id}")
def api_delete_conversation(conversation_id: str):
    delete_conversation(conversation_id)
    return {"conversation_id": conversation_id, "deleted": True}


# =========================================================
# 依 bone_id 取圖片（給 RAG 用）
# =========================================================
@app.get("/bones/{bone_id}/image")
def api_get_bone_image(bone_id: int):
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

    if image_data is not None:
        return Response(content=bytes(image_data), media_type=media_type)

    if image_path:
        rel = str(image_path).lstrip("/")
        file_path = PROJECT_ROOT / rel
        if file_path.exists():
            with open(file_path, "rb") as f:
                data = f.read()
            return Response(content=data, media_type=media_type)

    raise HTTPException(status_code=404, detail="image file not found")
