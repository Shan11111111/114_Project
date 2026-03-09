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

# ✅ 重要：RAG 匯入（防爆）
from .tools.rag_tool import answer_with_rag
try:
    from .tools.rag_tool import answer_with_doc_rag
except Exception:
    answer_with_doc_rag = answer_with_rag  # type: ignore

from .tools.doc_tool import extract_text_and_summary

# ✅ URL 索引：從 doc_tool 匯入（若你 doc_tool 尚未加 index_url / build_url_digest，會走 fallback）
try:
    from .tools.doc_tool import index_url, build_url_digest, is_enabled as doc_rag_enabled
except Exception:
    index_url = None  # type: ignore
    build_url_digest = None  # type: ignore
    doc_rag_enabled = lambda: False  # type: ignore

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
    ensure_conversation_exists,
)

app = FastAPI(title="S2 Legacy Agent (Integrated)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=str(USER_UPLOAD_DIR)), name="uploads")
app.include_router(export_router)


# =========================================================
# Helpers
# =========================================================
URL_RE = re.compile(r"(https?://[^\s\]\)]+)", re.IGNORECASE)


def _extract_question(text: str) -> str:
    t = (text or "").strip()
    if "\n---\n" in t:
        t = t.split("\n---\n", 1)[0].strip()
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


def _collect_urls(text: str) -> list[str]:
    if not text:
        return []
    urls = URL_RE.findall(text)
    # 去重但保序
    seen = set()
    out = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


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
            "doc_rag_enabled": bool(doc_rag_enabled()),
            "has_index_url": bool(index_url is not None),
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

    public_url = f"/public/user_upload_file/{fname}"
    legacy_url = f"/uploads/{fname}"

    result = {
        "url": public_url,
        "legacy_url": legacy_url,
        "filetype": safe_ext,
        "filename": original,
        "storage": "public/user_upload_file",
    }

    if safe_ext in {"pdf", "pptx", "txt", "docx", "xlsx", "csv"}:
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

    raw_cid = (getattr(req, "conversation_id", None) or "").strip()
    if raw_cid:
        conversation_id = session_to_conversation_uuid(raw_cid)
    else:
        conversation_id = session_to_conversation_uuid(session_id)

    ensure_conversation_exists(conversation_id, user_id=user_id, source="s2x")

    session = get_session(conversation_id)
    append_messages(session, [req.messages[-1]])

    last_in = req.messages[-1]
    if last_in.role == "user":
        attachments_json = None
        if last_in.type == "image" and last_in.url:
            attachments_json = json.dumps(
                {"url": last_in.url, "filetype": last_in.filetype},
                ensure_ascii=False
            )

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
            answer=tip,
        )

    # text
    if last.type == "text" and last.role == "user":
        raw_q = (last.content or "").strip()
        if not raw_q:
            raise HTTPException(status_code=400, detail="empty text message")

        clean_q = _extract_question(raw_q)

        # ✅ 1) 先解析 URL 並索引（讓 doc_rag 真的找得到）
        url_digest_text = ""
        urls = _collect_urls(clean_q)
        if urls and index_url is not None and build_url_digest is not None:
            digests = []
            for u in urls[:3]:
                try:
                    idx = index_url(url=u, conversation_id=str(conversation_id), user_id=user_id)
                    # idx 可能回傳 dict：{ok, title, summary, warning...}
                    digests.append(build_url_digest(idx))
                except Exception as e:
                    digests.append(f"【已解析網址】{u}\n【解析失敗】{e}")
            url_digest_text = "\n\n".join([d for d in digests if d]).strip()

        # ✅ 2) 讓「解析結果」進入回答的核心（放在問題上方當 context）
        if url_digest_text:
            clean_q_for_answer = (
                f"{url_digest_text}\n\n"
                f"---\n"
                f"【使用者問題】{clean_q}\n"
                f"請把上面「已解析網址/摘要」視為證據，優先用於 1) 直接回答。"
            )
        else:
            clean_q_for_answer = clean_q

        # ✅ 3) 用 doc_rag（命中才會引用 doc/網址 chunk）
        ans_text, sources = answer_with_doc_rag(clean_q_for_answer, session)
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
            answer=ans_text_out,
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

    conv_id = create_conversation(uid, title=title, source="s2x")
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

    cid = session_to_conversation_uuid(str(conversation_id))
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
