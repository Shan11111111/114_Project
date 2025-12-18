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
from .tools.doc_tool import extract_text_and_summary
from .routers.export import router as export_router

from fastapi import Request
from db import session_to_conversation_uuid  # noqa: E402

# =========================================================
# 找到 BoneOrthoBackend 專案根目錄（有 db.py 的那層）
# =========================================================
def _find_backend_root() -> Path:
    p = Path(__file__).resolve()
    for _ in range(20):
        if (p / "db.py").exists():
            return p
        p = p.parent
    return Path(__file__).resolve().parents[4]


BACKEND_ROOT = _find_backend_root()

# 確保可以 import 到專案根目錄的 db.py
if str(BACKEND_ROOT) not in sys.path:
    sys.path.append(str(BACKEND_ROOT))

# 載入 .env（放在 BoneOrthoBackend/.env）
load_dotenv(BACKEND_ROOT / ".env")

# =========================================================
# ✅ 找 BoneOrthoSystem 根目錄（為了 public）
# =========================================================
def _find_system_root(target_folder="BoneOrthoSystem") -> Path:
    p = Path(__file__).resolve()
    for _ in range(30):
        if p.name == target_folder:
            return p
        p = p.parent
    # 保底：通常 BoneOrthoBackend 的上一層就是 BoneOrthoSystem
    return BACKEND_ROOT.parent


SYSTEM_ROOT = _find_system_root("BoneOrthoSystem")
PUBLIC_DIR = SYSTEM_ROOT / "public"
PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

# ✅ 你指定：S2 上傳都放這裡
USER_UPLOAD_DIR = PUBLIC_DIR / "user_upload_file"
USER_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

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

app = FastAPI(title="S2 Legacy Agent (Integrated)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ✅ /s2x/uploads/* 靜態服務：改成指向 public/user_upload_file（資料夾不再分裂）
app.mount("/uploads", StaticFiles(directory=str(USER_UPLOAD_DIR)), name="uploads")

# 匯出 PDF/PPTX router
app.include_router(export_router)


# =========================================================
# 工具：把 ChatMessage 存進 DB
# =========================================================
def add_message_to_db_from_chatmessage(
    conversation_id: str,
    msg: ChatMessage,
    user_id: str,
    sources: list[dict] | None = None,
):
    attachments_json = None

    if msg.type == "image" and msg.url:
        attachments_json = json.dumps(
            {"url": msg.url, "filetype": msg.filetype},
            ensure_ascii=False,
        )

    add_message(
        conversation_id=conversation_id,
        role=msg.role,
        content=msg.content or "",
        attachments_json=attachments_json,
        sources=sources,
        user_id=user_id,  # ✅ 新增：真正 user_id
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
        return {
            "status": "ok",
            "db": row[0],
            "public_dir": str(PUBLIC_DIR),
            "user_upload_dir": str(USER_UPLOAD_DIR),
        }
    except Exception as e:
        return {"status": "error", "detail": str(e)}


# =========================================================
# 通用上傳端點（legacy 版）：仍保留 /s2x/upload
# ✅ 實體存到 public/user_upload_file
# ✅ 回傳 url 用 /public/user_upload_file/...（給前端最穩）
# 另外附 legacy_url=/uploads/...（若你要走 /s2x/uploads 也可以）
# =========================================================
_ALLOWED_UPLOAD_EXT = {
    "png", "jpg", "jpeg", "webp", "bmp",
    "pdf", "txt", "csv",
    "ppt", "pptx",
    "doc", "docx",
    "xls", "xlsx",
}

def _ext_of(filename: str) -> str:
    parts = (filename or "").rsplit(".", 1)
    if len(parts) == 2:
        return parts[1].lower()
    return ""

@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    original = file.filename or ""
    ext = _ext_of(original)

    if ext and ext not in _ALLOWED_UPLOAD_EXT:
        raise HTTPException(status_code=400, detail=f"不支援的檔案格式: .{ext}")

    safe_ext = ext or "bin"
    fname = f"s2_{uuid.uuid4().hex}.{safe_ext}"
    fpath = USER_UPLOAD_DIR / fname

    data = await file.read()
    with open(fpath, "wb") as f:
        f.write(data)

    public_url = f"/public/user_upload_file/{fname}"   # ✅ 前端 toAbsoluteUrl 最穩
    legacy_url = f"/uploads/{fname}"                   # 會變成 /s2x/uploads/{fname}

    result = {
        "url": public_url,
        "legacy_url": legacy_url,
        "filetype": safe_ext,
        "filename": original,
        "storage": "public/user_upload_file",
    }

    # ✅ 有能力就抽文字；抽不到也不要炸（你要的是「可上傳」，不是「一定要轉成功」）
    if safe_ext in {"pdf", "ppt", "pptx", "txt", "doc", "docx", "xls", "xlsx", "csv"}:
        try:
            text, summary = extract_text_and_summary(fpath, safe_ext)
            result["text"] = text
            result["summary"] = summary
        except Exception as e:
            result["text"] = None
            result["summary"] = None
            result["extract_warning"] = f"extract_text failed: {e}"

    return result

# s2_agent/legacy_agent/backend/app/main.py
from uuid import UUID, uuid4

def ensure_guid(s: str | None) -> str:
    if not s:
        return str(uuid4())
    try:
        return str(UUID(str(s).strip()))
    except Exception:
        return str(uuid4())

# =========================================================
# 主要聊天端點：RAG（不做 S2 YOLO）
# =========================================================
@app.post("/agent/chat", response_model=ChatResponse)
def agent_chat(req: ChatRequest, request: Request):
    if not req.session_id:
        raise HTTPException(status_code=400, detail="session_id is required")

    # ✅ 1) session_id → conversation GUID（若本來就 GUID 就原樣）
    conversation_id = session_to_conversation_uuid(req.session_id)

    # ✅ 2) user_id 從 header 帶（前端送 x-user-id），沒有就 guest
    user_id = request.headers.get("x-user-id", "guest").strip() or "guest"

    # session（記憶體）
    session = get_session(conversation_id)
    append_messages(session, req.messages)

    # 先把前端傳進來的訊息全部寫入 DB
    for msg in req.messages:
        add_message_to_db_from_chatmessage(conversation_id, msg, user_id=user_id)

    last = req.messages[-1]
    actions: list[Action] = []

    # 圖片
    if last.type == "image" and last.role == "user":
        session["current_image_url"] = last.url

        tip = (
            "✅ 我收到圖片了。\n"
            "這裡不會再做 S2 YOLO（我們只信 S1 的偵測結果）。\n"
            "你可以直接問：要『衛教版』還是『判讀重點』？"
        )

        reply = ChatMessage(role="assistant", type="text", content=tip)
        session["messages"].append(reply)
        add_message_to_db_from_chatmessage(conversation_id, reply, user_id=user_id)

        return ChatResponse(messages=session["messages"], actions=[])

    # 文字：走 RAG
    if last.type == "text" and last.role == "user":
        user_q = (last.content or "").strip()
        if not user_q:
            raise HTTPException(status_code=400, detail="empty text message")

        ans_text, sources = answer_with_rag(user_q, session)

        reply = ChatMessage(role="assistant", type="text", content=ans_text)
        session["messages"].append(reply)
        add_message_to_db_from_chatmessage(conversation_id, reply, user_id=user_id, sources=sources)

        # title seed（你原本那段縮排也有問題，我順便修乾淨）
        def _title_seed(text: str, max_len: int = 60) -> str:
            s = (text or "").strip().splitlines()[0].strip()
            s = " ".join(s.split())
            return (s[:max_len] if s else "新對話")

        set_conversation_title_if_empty(conversation_id, _title_seed(user_q, 60))

        return ChatResponse(messages=session["messages"], actions=actions)

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
    conv_id = create_conversation(payload.user_id, payload.title)
    title = payload.title or "新的對話"
    return {"conversation_id": conv_id, "title": title}


@app.get("/agent/conversations/{conversation_id}/messages", response_model=ChatResponse)
def api_get_conversation_messages(conversation_id: str):
    rows = get_messages(conversation_id)

    messages: list[ChatMessage] = []

    for r in rows:
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
        file_path = SYSTEM_ROOT / rel
        if file_path.exists():
            with open(file_path, "rb") as f:
                data = f.read()
            return Response(content=data, media_type=media_type)

    raise HTTPException(status_code=404, detail="image file not found")
