# 這個 main.py 是 S2 Legacy Agent 的核心後端服務，提供聊天、檔案上傳、對話管理等 API。

from __future__ import annotations

import json

import re
import sys
import uuid

from .tools.doc_tool import extract_text_and_summary, index_document

from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .models import ChatRequest, ChatResponse, ChatMessage, Action, ChatResource
from .state.sessions import get_session, append_messages

from .tools.pubmed_tool import answer_with_pubmed
from .tools.soap_csv_service import answer_with_soap_csv

#  重要：RAG 匯入（防爆）
from .tools.rag_tool import answer_with_rag
try:
    from .tools.rag_tool import answer_with_doc_rag
except Exception:
    answer_with_doc_rag = answer_with_rag  # type: ignore

from .tools.doc_tool import extract_text_and_summary

#  URL 索引：從 doc_tool 匯入（若你 doc_tool 尚未加 index_url / build_url_digest，會走 fallback）
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

MATERIALS_DIR = BACKEND_ROOT / "s2_agent" / "vectordb" / "materials"
MATERIALS_DIR.mkdir(parents=True, exist_ok=True)

print("📌 PUBLIC_DIR =", PUBLIC_DIR)
print("📌 USER_UPLOAD_DIR =", USER_UPLOAD_DIR)
print("📌 MATERIALS_DIR =", MATERIALS_DIR)

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
app.mount("/materials", StaticFiles(directory=str(MATERIALS_DIR)), name="materials")
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
        if not isinstance(s, dict):
            continue
    

        title = (
            s.get("title")
            or s.get("file")
            or s.get("name")
            or s.get("filename")
            or f"source-{i}"
        )

        page = s.get("page")
        chunk = s.get("chunk") or s.get("chunk_index") or s.get("chunk_id")
        score = s.get("score")

        meta = []
        if page is not None:
            meta.append(f"p.{page}")
        elif chunk is not None:
            meta.append(f"chunk {chunk}")

        if score is not None:
            try:
                meta.append(f"score={float(score):.3f}")
            except Exception:
                pass

        if meta:
            lines.append(f"[#{i}] {title} ({', '.join(meta)})")
        else:
            lines.append(f"[#{i}] {title}")

    if not lines:
        return ""
    
    # 注意：這裡的格式是給純文字回答用的，如果你要在前端做更好看的展示，建議直接用 sources 裡的結構化資料，不要這個文本版本。
    return ""
    # return "\n\n---\n【Sources】\n" + "\n".join(lines)



def _build_resources(sources: list[dict] | None) -> list[ChatResource]:
    if not sources:
        return []

    resources: list[ChatResource] = []

    allowed_exts = [".pdf", ".doc", ".docx", ".ppt", ".pptx", ".txt", ".md", ".csv", ".xlsx", ".xls"]

    for i, s in enumerate(sources, 1):
        if not isinstance(s, dict):
            continue

        # 先過濾低分來源
        try:
            score = s.get("score")
            if score is not None and float(score) < 0.65:
                continue
        except Exception:
            pass

        title = (
            s.get("title")
            or s.get("file")
            or s.get("name")
            or s.get("filename")
            or s.get("source")
            or f"source-{i}"
        )
        file_stem = (
            s.get("file")
            or s.get("filename")
            or s.get("title")
            or s.get("source")
            or ""
        )

        title_str = str(title).strip()
        file_stem_str = str(file_stem).strip()

        url = (
            s.get("url")
            or s.get("download_url")
            or s.get("file_url")
            or s.get("serverUrl")
            or s.get("path")
        )

        # 如果 source 沒直接給 url，就去 materials 資料夾找實際檔案
        if not url and file_stem_str:
            candidates = []

            candidates.append(file_stem_str)

            lower_name = file_stem_str.lower()
            if not any(lower_name.endswith(ext) for ext in allowed_exts):
                for ext in allowed_exts:
                    candidates.append(file_stem_str + ext)

            found_name = None
            for cand in candidates:
                p = MATERIALS_DIR / cand
                if p.exists():
                    found_name = cand
                    break

            if found_name:
                url = f"/s2x/materials/{found_name}"

        download_url = s.get("download_url") or url

        page = None
        if s.get("page") is not None:
            page = f"p.{s.get('page')}"
        else:
            chunk = s.get("chunk") or s.get("chunk_index") or s.get("chunk_id")
            if chunk is not None:
                page = f"chunk {chunk}"

        snippet = (
            s.get("snippet")
            or s.get("text")
            or s.get("content")
            or s.get("summary")
            or s.get("quote")
        )

        source_type = (
            s.get("source_type")
            or s.get("type")
            or s.get("collection")
            or s.get("kind")
            or "reference"
        )

        resources.append(
            ChatResource(
                title=title_str,
                url=str(url) if url else None,
                download_url=str(download_url) if download_url else None,
                source_type=str(source_type) if source_type else None,
                page=page,
                snippet=str(snippet)[:300] if snippet else None,
                score=float(s.get("score")) if s.get("score") is not None else None,
            )
        )

    return resources

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

    public_url = f"/uploads/{fname}"
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

            try:
                indexed = index_document(
                    text=text,
                    title=original or fname,
                    source_type="upload",
                    material_id=fname,
                    url=public_url,
                    conversation_id=None,
                    user_id=None,
                )
                result["indexed_chunks"] = indexed
            except Exception as ie:
                result["index_warning"] = f"index_document failed: {ie}"

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
            " 我收到圖片了。\n"
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
            resources=[],
            )

    # text
    if last.type == "text" and last.role == "user":
        raw_q = (last.content or "").strip()
        if not raw_q:
            raise HTTPException(status_code=400, detail="empty text message")

        clean_q = _extract_question(raw_q)

        rag_mode = (getattr(req, "rag_mode", None) or "file_then_vector").strip()
        pubmed_max_results = int(getattr(req, "pubmed_max_results", 5) or 5)
        pubmed_max_results = max(1, min(pubmed_max_results, 8))

        # =========================
        # PubMed only 分支
        # =========================
        if rag_mode == "pubmed_only":
            ans_text, sources = answer_with_pubmed(
                question=clean_q,
                max_results=pubmed_max_results,
            )

            # 額外把 PMID / journal / year / url 整理成文字附在回答下面
            pubmed_source_lines = []
            for i, s in enumerate(sources or [], 1):
                title = s.get("title") or f"pubmed-{i}"
                pmid = s.get("pmid") or ""
                journal = s.get("journal") or ""
                year = s.get("year") or ""
                url = s.get("url") or ""

                tail = " · ".join([x for x in [journal, year, f"PMID:{pmid}" if pmid else ""] if x])
                if tail:
                    pubmed_source_lines.append(f"[#{i}] {title} · {tail}")
                else:
                    pubmed_source_lines.append(f"[#{i}] {title}")

                if url:
                    pubmed_source_lines.append(f"    {url}")

            if pubmed_source_lines:
                ans_text_out = (
                    (ans_text or "").rstrip()
                    + "\n\n---\n【PubMed Sources】\n"
                    + "\n".join(pubmed_source_lines)
                )
            else:
                ans_text_out = ans_text or ""

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

            resources = _build_resources(sources)

            return ChatResponse(
                messages=session["messages"],
                actions=actions,
                session_id=session_id,
                conversation_id=conversation_id,
                answer=ans_text_out,
                resources=resources,
            )
        
           
        # =========================
        # SOAP CSV only 分支
        # =========================
        if rag_mode == "soap_only":
            ans_text, sources = answer_with_soap_csv(
                question=clean_q,
                max_results=5,
            )

            soap_source_lines = []
            for i, s in enumerate(sources or [], 1):
                title = s.get("title") or f"soap-{i}"
                record_id = s.get("record_id") or ""
                visit_date = s.get("visit_date") or ""

                tail = " · ".join(
                    [x for x in [f"RRN:{record_id}" if record_id else "", visit_date] if x]
                )
                if tail:
                    soap_source_lines.append(f"[#{i}] {title} · {tail}")
                else:
                    soap_source_lines.append(f"[#{i}] {title}")

            if soap_source_lines:
                ans_text_out = (
                    (ans_text or "").rstrip()
                    + "\n\n---\n【SOAP Sources】\n"
                    + "\n".join(soap_source_lines)
                )
            else:
                ans_text_out = ans_text or ""

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

            resources = _build_resources(sources)

            return ChatResponse(
                messages=session["messages"],
                actions=actions,
                session_id=session_id,
                conversation_id=conversation_id,
                answer=ans_text_out,
                resources=resources,
            )








        #  1) 先解析 URL 並索引（讓 doc_rag 真的找得到）
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

        #  2) 讓「解析結果」進入回答的核心（放在問題上方當 context）
        if url_digest_text:
            clean_q_for_answer = (
                f"{url_digest_text}\n\n"
                f"---\n"
                f"【使用者問題】{clean_q}\n"
                f"請把上面「已解析網址/摘要」視為證據，優先用於 1) 直接回答。"
            )
        else:
            clean_q_for_answer = clean_q

        #  3) 用 doc_rag（命中才會引用 doc/網址 chunk）
        # ans_text, sources = answer_with_doc_rag(clean_q_for_answer, session)
        
        has_fresh_uploads = False
        for m in req.messages:
            if getattr(m, "role", None) != "user":
                continue

            msg_type = getattr(m, "type", None)
            msg_url = getattr(m, "url", None)
            msg_content = getattr(m, "content", None) or ""

            if msg_type in {"image", "file"} and msg_url:
                has_fresh_uploads = True
                break

            if "/uploads/" in str(msg_content):
                has_fresh_uploads = True
                break

        ans_text, sources = answer_with_doc_rag(
            clean_q_for_answer,
            session,
            has_fresh_uploads=has_fresh_uploads,
        )
        
        
        print("DEBUG clean_q =", clean_q)
        print("DEBUG clean_q_for_answer =", clean_q_for_answer)
        print("DEBUG rag_mode =", rag_mode)

        print("DEBUG source scores start")
        for i, s in enumerate(sources or [], 1):
            try:
                title = s.get("title") or s.get("display_title") or f"source-{i}"
                score = s.get("score")
                source_type = s.get("source_type") or s.get("kind")
                page = s.get("page")
                chunk = s.get("chunk")
                print(
                    f"[{i}] score={score} | type={source_type} | page={page} | chunk={chunk} | title={title}"
                )
            except Exception as e:
                print(f"[{i}] source print failed: {e}")
        print("DEBUG source scores end")
        
        # ans_text_out = (ans_text or "").rstrip() + _format_sources_for_text(sources)
        ans_text_out = (ans_text or "").strip()

        # 問題很短時，至少要求主關鍵詞要真的出現在來源裡
        if len(clean_q) <= 12:
            filtered_sources = []
            main_terms = []

            if "血友病" in clean_q:
                main_terms.append("血友病")
            if "骨質疏鬆" in clean_q:
                main_terms.append("骨質疏鬆")
            if "停經" in clean_q:
                main_terms.append("停經")
            if "糖尿病" in clean_q:
                main_terms.append("糖尿病")

            for s in sources or []:
                blob = " ".join([
                    str(s.get("title") or ""),
                    str(s.get("snippet") or ""),
                    str(s.get("text") or ""),
                ])

                if main_terms and not any(term in blob for term in main_terms):
                    continue

                filtered_sources.append(s)

            sources = filtered_sources

        resources = _build_resources(sources)

        print("DEBUG sources =", sources)
        print("DEBUG resources =", [r.model_dump() for r in resources])

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
        
        resources = _build_resources(sources)

        return ChatResponse(
            messages=session["messages"],
            actions=actions,
            session_id=session_id,
            conversation_id=conversation_id,
            answer=ans_text_out,
            resources=resources,
        )
    
    

    return ChatResponse(
        messages=session["messages"],
        actions=actions,
        session_id=session_id,
        conversation_id=conversation_id,
        answer=None,
        resources=[],

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
