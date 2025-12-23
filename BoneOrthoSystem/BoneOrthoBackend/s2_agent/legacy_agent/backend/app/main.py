# main.py
from __future__ import annotations

import json
import re
import sys
import uuid
from pathlib import Path

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


# =========================================================
# 找到 BoneOrthoBackend 專案根目錄（有 db.py 的那層）
# =========================================================
def _find_backend_root() -> Path:
    p = Path(__file__).resolve()
    for _ in range(30):
        if (p / "db.py").exists():
            return p
        p = p.parent
    return Path(__file__).resolve().parents[6]


BACKEND_ROOT = _find_backend_root()

if str(BACKEND_ROOT) not in sys.path:
    sys.path.append(str(BACKEND_ROOT))

load_dotenv(BACKEND_ROOT / ".env")


# =========================================================
# 找 BoneOrthoSystem 根目錄（為了 public）
# =========================================================
def _find_system_root(target_folder="BoneOrthoSystem") -> Path:
    p = Path(__file__).resolve()
    for _ in range(40):
        if p.name == target_folder:
            return p
        p = p.parent
    return BACKEND_ROOT.parent


SYSTEM_ROOT = _find_system_root("BoneOrthoSystem")
PUBLIC_DIR = SYSTEM_ROOT / "public"
PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

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
    session_to_conversation_uuid,
    ensure_conversation_exists,   # ✅ 先建 Conversation（UserId 正確），避免後續亂寫
)

app = FastAPI(title="S2 Legacy Agent (Integrated)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# /s2x/uploads/* 由上層 app 掛 /s2x；這裡 mount "/uploads"
app.mount("/uploads", StaticFiles(directory=str(USER_UPLOAD_DIR)), name="uploads")

app.include_router(export_router)


# =========================================================
# Helpers
# =========================================================
def _extract_question(text: str) -> str:
    """
    前端會把 prompt 後面加 --- RAG 指令/檔案摘要
    ✅ 向量檢索只能用「真正問題」，避免污染 query
    """
    t = (text or "").strip()
    if "\n---\n" in t:
        t = t.split("\n---\n", 1)[0].strip()
    # 壓縮空白
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _title_seed(text: str, max_len: int = 80) -> str:
    s = (text or "").strip().splitlines()[0].strip()
    s = re.sub(r"\s+", " ", s).strip()
    return (s[:max_len] if s else "新對話")


def _format_sources_for_text(sources: list[dict] | None) -> str:
    if not sources:
        return ""
    lines = []
    for i, s in enumerate(sources, 1):
        title = s.get("title") or s.get("file") or s.get("name") or f"source-{i}"
        page = s.get("page")
        chunk = s.get("chunk") or s.get("chunk_index") or s.get("chunk_id")
        score = s.get("score") or s.get("similarity")
        meta = []
        if page is not None:
            meta.append(f"p.{page}")
        if chunk is not None:
            meta.append(f"chunk:{chunk}")
        if isinstance(score, (int, float)):
            meta.append(f"score:{score:.3f}")
        tail = (" · " + " · ".join(meta)) if meta else ""
        lines.append(f"[#{i}] {title}{tail}")
    return "\n\n---\n【Sources】\n" + "\n".join(lines)


# =========================================================
# Health
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
# Upload
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

    public_url = f"/public/user_upload_file/{fname}"   # 給 Next 最穩
    legacy_url = f"/uploads/{fname}"                   # 變成 /s2x/uploads/{fname}

    result = {
        "url": public_url,
        "legacy_url": legacy_url,
        "filetype": safe_ext,
        "filename": original,
        "storage": "public/user_upload_file",
    }

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


# =========================================================
# Chat (RAG)
# =========================================================
@app.post("/agent/chat", response_model=ChatResponse)
def agent_chat(req: ChatRequest):
    if not req.session_id:
        raise HTTPException(status_code=400, detail="session_id is required")
    if not req.messages:
        raise HTTPException(status_code=400, detail="messages is empty")

    user_id = (getattr(req, "user_id", None) or "guest").strip() or "guest"
    session_id = req.session_id.strip()

    # ✅ 1) 先用前端給的永久 GUID（conversation_id）
    # ✅ 2) 沒給才 fallback：用 session_id 轉 deterministic GUID（兼容舊行為）
    raw_cid = (getattr(req, "conversation_id", None) or "").strip()
    if raw_cid:
        conversation_id = session_to_conversation_uuid(raw_cid)  # GUID normalize
    else:
        conversation_id = session_to_conversation_uuid(session_id)

    # ✅ 確保 DB Conversation 存在 & UserId 正確
    ensure_conversation_exists(conversation_id, user_id=user_id, source="s2x")

    # ✅ session memory key 用 conversation_id（GUID）
    session = get_session(conversation_id)
    append_messages(session, [req.messages[-1]])

    # ✅ 寫入 user messages（記得把 user_id 傳進 add_message）
    # ✅ 只存最新一則 user 訊息，避免重複寫入
    last_in = req.messages[-1]
    if last_in.role == "user":
        attachments_json = None
        if last_in.type == "image" and last_in.url:
            attachments_json = json.dumps({"url": last_in.url, "filetype": last_in.filetype}, ensure_ascii=False)

        add_message(
            conversation_id=conversation_id,
            role=last_in.role,
            content=last_in.content or "",
            attachments_json=attachments_json,
            sources=None,
            user_id=user_id,
            source="s2x",
    )

    last = req.messages[-1]
    actions: list[Action] = []

    # image
    if last.type == "image" and last.role == "user":
        session["current_image_url"] = last.url
        tip = (
            "✅ 我收到圖片了。\n"
            "這裡不做 S2 YOLO（我們只信 S1 偵測）。\n"
            "你可以直接問：想了解哪個部位？要『衛教版』還是『判讀重點』？"
        )

        reply = ChatMessage(role="assistant", type="text", content=tip)
        session["messages"].append(reply)

        add_message(
            conversation_id=conversation_id,
            role="assistant",
            content=tip,
            attachments_json=None,
            sources=None,
            user_id=user_id,
            source="s2x",
        )

        return ChatResponse(
            messages=session["messages"],
            actions=[],
            session_id=session_id,
            conversation_id=conversation_id,
            answer=tip,  # 可選
        )

    # text
    if last.type == "text" and last.role == "user":
        raw_q = (last.content or "").strip()
        if not raw_q:
            raise HTTPException(status_code=400, detail="empty text message")

        clean_q = _extract_question(raw_q)
        ans_text, sources = answer_with_rag(clean_q, session)
        ans_text_out = (ans_text or "").rstrip() + _format_sources_for_text(sources)

        reply = ChatMessage(role="assistant", type="text", content=ans_text_out)
        session["messages"].append(reply)

        add_message(
            conversation_id=conversation_id,
            role="assistant",
            content=ans_text_out,
            attachments_json=None,
            sources=sources,
            user_id=user_id,
            source="s2x",
        )

        set_conversation_title_if_empty(conversation_id, _title_seed(clean_q, 80))

        return ChatResponse(
            messages=session["messages"],
            actions=actions,
            session_id=session_id,
            conversation_id=conversation_id,
            answer=ans_text_out,  # 可選
        )

    return ChatResponse(
        messages=session["messages"],
        actions=actions,
        session_id=session_id,
        conversation_id=conversation_id,
    )


# =========================================================
# Conversation APIs
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
    uid = (payload.user_id or "guest").strip() or "guest"
    title = (payload.title or "新對話").strip() or "新對話"

    # ✅ 永久 GUID（已寫入 agent.Conversation）
    conv_id = create_conversation(uid, title=title, source="s2x")

    # ✅ 暫時 session_id（不寫 DB，前端自己存 mapping）
    sid = f"{uid}::{uuid.uuid4().hex}"

    return {"conversation_id": conv_id, "session_id": sid, "title": title}


@app.get("/agent/conversations/{conversation_id}/messages", response_model=ChatResponse)
def api_get_conversation_messages(conversation_id: str):
    rows = get_messages(conversation_id)

    messages: list[ChatMessage] = []
    for r in rows:
        role = r.get("Role") or r.get("role")
        content = r.get("Content") or r.get("content")
        attachments_json = r.get("AttachmentsJson") or r.get("attachments_json") or r.get("attachments")

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

    cid = session_to_conversation_uuid(str(conversation_id))  # ✅ normalize GUID
    session = get_session(cid)
    session["messages"] = messages

    return ChatResponse(messages=messages, actions=[], conversation_id=cid)


@app.delete("/agent/conversations/{conversation_id}")
def api_delete_conversation(conversation_id: str):
    cid = session_to_conversation_uuid(str(conversation_id))
    delete_conversation(cid)
    return {"conversation_id": cid, "deleted": True}

# =========================================================
# bone image
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
