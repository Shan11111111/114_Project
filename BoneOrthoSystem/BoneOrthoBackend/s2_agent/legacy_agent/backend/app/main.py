# 這個 main.py 是 S2 Legacy Agent 的核心後端服務，提供聊天、檔案上傳、對話管理等 API。
#s2_agent/legacy_agent/backend/app/main.py

from __future__ import annotations

import json
import re
import sys
import uuid

import time  # 計時器套件
from fastapi.responses import StreamingResponse  # 用於串流回應

from .tools.doc_tool import extract_text_and_summary, index_document

from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .models import ChatRequest, ChatResponse, ChatMessage, Action, ChatResource
from .state.sessions import get_session, append_messages

from .tools.pubmed_tool import answer_with_pubmed, retrieve_pubmed_sources
from .tools.soap_csv_service import answer_with_soap_csv, retrieve_soap_sources
from .tools.rag_fusion_tool import prepare_auto_fusion_answer

# 重要：RAG 匯入（防爆）
from .tools.rag_tool import answer_with_rag, _build_dialog_state, prepare_answer_with_doc_rag, _call_llm_stream
try:
    from .tools.rag_tool import answer_with_doc_rag
except Exception:
    answer_with_doc_rag = answer_with_rag  # type: ignore

from .tools.doc_tool import extract_text_and_summary

# URL 索引：從 doc_tool 匯入（若你 doc_tool 尚未加 index_url / build_url_digest，會走 fallback）
try:
    from .tools.doc_tool import index_url, build_url_digest, is_enabled as doc_rag_enabled
except Exception:
    index_url = None  # type: ignore
    build_url_digest = None  # type: ignore
    doc_rag_enabled = lambda: False  # type: ignore

from .routers.export import router as export_router
from s2_agent.evals.faithfulness_eval import evaluate_faithfulness

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
IMAGE_CASE_RE = re.compile(r"ImageCaseId\s*:\s*(\d+)", re.IGNORECASE)


def _extract_image_case_id(text: str | None) -> int | None:
    if not text:
        return None
    m = IMAGE_CASE_RE.search(text)
    if not m:
        return None
    try:
        return int(m.group(1))
    except Exception:
        return None

def _append_request_messages_to_session(session: dict, messages: list[ChatMessage]) -> None:
    """
    把前端送來的最近對話上下文放進 session。
    讓追問「再查其他網站」「前面那個」能接上上一輪主題。
    """
    if not session or not messages:
        return

    session.setdefault("messages", [])

    existing_keys = set()
    for m in session.get("messages", []):
        if isinstance(m, dict):
            role = m.get("role")
            content = m.get("content")
        else:
            role = getattr(m, "role", None)
            content = getattr(m, "content", None)

        existing_keys.add((role, content))

    for m in messages:
        role = getattr(m, "role", None)
        content = getattr(m, "content", None)

        if not content:
            continue

        key = (role, content)
        if key in existing_keys:
            continue

        session["messages"].append(m)
        existing_keys.add(key)

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


def _get_image_attachment_by_case_id(case_id: int | None) -> dict | None:
    if not case_id:
        return None

    sql = """
    SELECT TOP 1
        ic.ImageCaseId,
        bi.image_path,
        bi.content_type
    FROM vision.ImageCase ic
    JOIN dbo.Bone_Images bi ON ic.BoneImageId = bi.image_id
    WHERE ic.ImageCaseId = ?
    """
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(sql, case_id)
            row = cur.fetchone()

        if not row:
            return None

        image_url = (getattr(row, "image_path", None) or "").strip()
        filetype = (getattr(row, "content_type", None) or "").strip() or None

        if not image_url:
            return None

        return {
            "url": image_url,
            "filetype": filetype,
        }
    except Exception:
        return None


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
            if score is not None and float(score) < 0.55:
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
                snippet=(
                    str(snippet)
                    if str(source_type).lower() == "3d_asset"
                    else str(snippet)[:300]
                ) if snippet else None,
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


@app.post("/agent/chat/stream")
def agent_chat_stream(req: ChatRequest):
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

    # 前端現在會送最近 6 則 messages。
    # 這裡要把前面的 messages 也放進 session，讓「再查其他網站」能接上上一輪主題。
    incoming_messages = list(req.messages or [])

    if incoming_messages:
        # 保留既有 session 訊息，再補這次 request 裡帶來的上下文
        session.setdefault("messages", [])

        existing_keys = set()
        for m in session.get("messages", []):
            try:
                existing_keys.add((
                    getattr(m, "role", None) if not isinstance(m, dict) else m.get("role"),
                    getattr(m, "content", None) if not isinstance(m, dict) else m.get("content"),
                ))
            except Exception:
                pass

        for m in incoming_messages:
            key = (m.role, m.content)
            if key not in existing_keys:
                session["messages"].append(m)
                existing_keys.add(key)

    last = req.messages[-1]
    if last.role != "user" or last.type != "text":
        raise HTTPException(status_code=400, detail="stream only supports user text message")

    raw_q = (last.content or "").strip()
    if not raw_q:
        raise HTTPException(status_code=400, detail="empty text message")

    clean_q = _extract_question(raw_q)
    image_case_id = _extract_image_case_id(last.content or "")

    rag_mode = (getattr(req, "rag_mode", None) or "file_then_vector").strip()
    pubmed_max_results = int(getattr(req, "pubmed_max_results", 5) or 5)
    pubmed_max_results = max(1, min(pubmed_max_results, 8))

    response_language = (
        getattr(req, "response_language", None)
        or getattr(req, "locale", None)
        or "zh-TW"
    ).strip()

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

    dialog_state = _build_dialog_state(clean_q, session)

    add_message(
        conversation_id=conversation_id,
        role="user",
        content=last.content or "",
        attachments_json=None,
        sources=None,
        user_id=user_id,
        source="s2x",
        image_case_id=image_case_id,
    )

    def _yield_token_chunks(text: str, chunk_size: int = 30):
        text = text or ""
        for i in range(0, len(text), chunk_size):
            yield text[i:i + chunk_size]

    def generate():
        full_answer_parts = []
        resources: list[ChatResource] = []

        try:
            yield json.dumps({
                "type": "meta",
                "conversation_id": conversation_id,
                "session_id": session_id,
            }, ensure_ascii=False) + "\n"

            # =========================
            # PubMed only 串流分支
            # =========================
            if rag_mode == "pubmed_only":
                ans_text, sources = answer_with_pubmed(
                    question=clean_q,
                    max_results=pubmed_max_results,
                )

                pubmed_source_lines = []
                for i, s in enumerate(sources or [], 1):
                    title = s.get("title") or f"pubmed-{i}"
                    pmid = s.get("pmid") or ""
                    journal = s.get("journal") or ""
                    year = s.get("year") or ""
                    url = s.get("url") or ""

                    tail = " · ".join(
                        [x for x in [journal, year, f"PMID:{pmid}" if pmid else ""] if x]
                    )

                    if tail:
                        pubmed_source_lines.append(f"[#{i}] {title} · {tail}")
                    else:
                        pubmed_source_lines.append(f"[#{i}] {title}")

                    if url:
                        pubmed_source_lines.append(f"    {url}")

                if pubmed_source_lines:
                    final_answer = (
                        (ans_text or "").rstrip()
                        + "\n\n---\n【PubMed Sources】\n"
                        + "\n".join(pubmed_source_lines)
                    )
                else:
                    final_answer = ans_text or ""

                resources = _build_resources(sources)

                yield json.dumps({
                    "type": "sources",
                    "data": [r.model_dump() for r in resources],
                }, ensure_ascii=False) + "\n"

                for chunk in _yield_token_chunks(final_answer, chunk_size=1):
                    full_answer_parts.append(chunk)
                    yield json.dumps({
                        "type": "token",
                        "data": chunk,
                    }, ensure_ascii=False) + "\n"

            # =========================
            # SOAP only 串流分支
            # =========================
            elif rag_mode == "soap_only":
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
                    final_answer = (
                        (ans_text or "").rstrip()
                        + "\n\n---\n【SOAP Sources】\n"
                        + "\n".join(soap_source_lines)
                    )
                else:
                    final_answer = ans_text or ""

                resources = _build_resources(sources)

                yield json.dumps({
                    "type": "sources",
                    "data": [r.model_dump() for r in resources],
                }, ensure_ascii=False) + "\n"

                for chunk in _yield_token_chunks(final_answer, chunk_size=1):
                    full_answer_parts.append(chunk)
                    yield json.dumps({
                        "type": "token",
                        "data": chunk,
                    }, ensure_ascii=False) + "\n"
            
            #==========================
            #rag_mode 融合串流分支（同時使用 PubMed、SOAP、Doc RAG 等多種工具，並整合來源）
            #==========================
            
            elif rag_mode == "auto_fusion":
                system, prompt, raw_resources = prepare_auto_fusion_answer(
                    clean_q,
                    session=session,
                    dialog_state=dialog_state,
                    pubmed_max_results=pubmed_max_results,
                    soap_max_results=2,
                    vector_top_k=3,
                    response_language=response_language,
                )

                resources = _build_resources(raw_resources)

                yield json.dumps({
                    "type": "sources",
                    "data": [r.model_dump() for r in resources],
                }, ensure_ascii=False) + "\n"

                for token in _call_llm_stream(system, prompt):
                    full_answer_parts.append(token)
                    yield json.dumps({
                        "type": "token",
                        "data": token,
                    }, ensure_ascii=False) + "\n"
                
            
            # =========================
            # 預設：doc_rag 串流分支
            # =========================
            else:
                system, prompt, raw_resources = prepare_answer_with_doc_rag(
                    clean_q,
                    session,
                    has_fresh_uploads=has_fresh_uploads,
                    dialog_state=dialog_state,
                )

                yield json.dumps({
                    "type": "sources",
                    "data": raw_resources,
                }, ensure_ascii=False) + "\n"

                if not system:
                    fallback_answer = prompt or ""
                    if fallback_answer:
                        full_answer_parts.append(fallback_answer)
                        yield json.dumps({
                            "type": "token",
                            "data": fallback_answer,
                        }, ensure_ascii=False) + "\n"
                else:
                    for token in _call_llm_stream(system, prompt):
                        full_answer_parts.append(token)
                        yield json.dumps({
                            "type": "token",
                            "data": token,
                        }, ensure_ascii=False) + "\n"

                resources = _build_resources(raw_resources)

            final_answer = "".join(full_answer_parts).strip()

            # =========================================
            # Faithfulness Evaluation (STREAM)
            # =========================================

            try:
                contexts = []

                for r in resources or []:
                    text = (
                        getattr(r, "snippet", None)
                        or ""
                    )

                    if text:
                        contexts.append({
    "title": getattr(r, "title", ""),
    "page": getattr(r, "page", ""),
    "source_type": getattr(r, "source_type", ""),
    "text": str(text),
})

                if contexts:
                    # 只評估「1) 綜合回答」，不要把學習重點、注意事項、延伸問題算進去
                    eval_answer = final_answer

                    if "2) 骨骼學習重點" in eval_answer:
                        eval_answer = eval_answer.split("2) 骨骼學習重點", 1)[0].strip()
                    elif "3) 注意事項" in eval_answer:
                        eval_answer = eval_answer.split("3) 注意事項", 1)[0].strip()

                    faithfulness_result = evaluate_faithfulness(
                        question=clean_q,
                        answer=eval_answer,
                        contexts=contexts,
                    )
                    
                    # =========================================
                    # Save Faithfulness Eval Log
                    # =========================================

                    try:
                        from db import get_connection

                        with get_connection() as conn:
                            cur = conn.cursor()

                            cur.execute("""
                                INSERT INTO agent.RagEvalLog
                                (
                                    ConversationId,
                                    UserId,
                                    Question,
                                    RagMode,
                                    Faithfulness,
                                    SupportedClaims,
                                    TotalClaims,
                                    EvalJson
                                )
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            str(conversation_id) if conversation_id else None,
                            user_id,
                            clean_q,
                            req.rag_mode,
                            faithfulness_result.get("faithfulness"),
                            faithfulness_result.get("supported_claims"),
                            faithfulness_result.get("total_claims"),
                            json.dumps(faithfulness_result, ensure_ascii=False)
                            )

                            conn.commit()

                    except Exception as e:
                        print("Save RagEvalLog failed:", e)

                    print("\n==============================")
                    print("FAITHFULNESS RESULT")
                    print(json.dumps(faithfulness_result, ensure_ascii=False, indent=2))
                    print("==============================\n")

            except Exception as e:
                print("Faithfulness eval failed:", e)
                
                
            reply = ChatMessage(role="assistant", type="text", content=final_answer)
            append_messages(session, [reply])

            add_message(
                conversation_id=conversation_id,
                role="assistant",
                content=final_answer,
                attachments_json=None,
                sources=[r.model_dump() for r in resources],
                user_id=user_id,
                source="s2x",
            )

            set_conversation_title_if_empty(conversation_id, _title_seed(clean_q, 80))

            yield json.dumps({
                "type": "done",
                "conversation_id": conversation_id,
                "session_id": session_id,
            }, ensure_ascii=False) + "\n"

        except Exception as e:
            yield json.dumps({
                "type": "error",
                "message": str(e),
            }, ensure_ascii=False) + "\n"

    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


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
    print("上傳了")
    print(">>> filename =", file.filename)
    original = file.filename or ""
    ext = _ext_of(original)

    if ext and ext not in _ALLOWED_UPLOAD_EXT:
        raise HTTPException(status_code=400, detail=f"不支援的檔案格式: .{ext}")

    safe_ext = ext or "bin"
    fname = f"s2_{uuid.uuid4().hex}.{safe_ext}"
    fpath = USER_UPLOAD_DIR / fname

    data = await file.read()
    print(">>> bytes =", len(data))
    print("上傳了")
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

            # 對話上傳檔案只做本輪解析，不寫入正式向量資料庫
            result["indexed_chunks"] = 0
            result["index_note"] = "chat upload parsed only; not indexed into vector db"

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

    session = get_session(conversation_id)

    incoming_messages = list(req.messages or [])

    if incoming_messages:
        session.setdefault("messages", [])

        existing_keys = set()
        for m in session.get("messages", []):
            try:
                existing_keys.add((
                    getattr(m, "role", None) if not isinstance(m, dict) else m.get("role"),
                    getattr(m, "content", None) if not isinstance(m, dict) else m.get("content"),
                ))
            except Exception:
                pass

        for m in incoming_messages:
            key = (m.role, m.content)
            if key not in existing_keys:
                session["messages"].append(m)
                existing_keys.add(key)

    last_in = req.messages[-1]
    
    if last_in.role == "user":
        attachments_json = None
        image_case_id = None

        if last_in.type == "image" and last_in.url:
            attachments_json = json.dumps(
                {"url": last_in.url, "filetype": last_in.filetype},
                ensure_ascii=False
            )

        if last_in.type == "text":
            image_case_id = _extract_image_case_id(last_in.content or "")

        add_message(
            conversation_id=conversation_id,
            role=last_in.role,
            content=last_in.content or "",
            attachments_json=attachments_json,
            sources=None,
            user_id=user_id,
            source="s2x",
            image_case_id=image_case_id,
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
        append_messages(session, [reply])

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

        response_language = (
            getattr(req, "response_language", None)
            or getattr(req, "locale", None)
            or "zh-TW"
        ).strip()

        # =========================
        # PubMed only 分支
        # =========================
        if rag_mode == "pubmed_only":
            ans_text, sources = answer_with_pubmed(
                question=clean_q,
                max_results=pubmed_max_results,
            )

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
            append_messages(session, [reply])

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
        # Auto Fusion RAG 分支
        # =========================
        if rag_mode == "auto_fusion":
            system, prompt, raw_sources = prepare_auto_fusion_answer(
                clean_q,
                session=session,
                dialog_state=_build_dialog_state(clean_q, session),
                pubmed_max_results=pubmed_max_results,
                soap_max_results=2,
                vector_top_k=3,
                response_language=response_language,
            )

            from .tools.rag_tool import _call_llm

            ans_text = _call_llm(system, prompt)
            ans_text_out = (ans_text or "").strip()
            
            # =========================================
            # Faithfulness Evaluation
            # =========================================

            faithfulness_result = None

            try:
                contexts = []

                for s in raw_sources or []:
                    text = (
                        s.get("snippet")
                        or s.get("text")
                        or s.get("content")
                        or ""
                    )

                    if text:
                        contexts.append({
    "title": getattr(r, "title", ""),
    "page": getattr(r, "page", ""),
    "source_type": getattr(r, "source_type", ""),
    "text": str(text),
})

                if contexts:
                    # 只評估「1) 綜合回答」，不要把學習重點、注意事項、延伸問題算進去
                    eval_answer = final_answer

                    if "2) 骨骼學習重點" in eval_answer:
                        eval_answer = eval_answer.split("2) 骨骼學習重點", 1)[0].strip()
                    elif "3) 注意事項" in eval_answer:
                        eval_answer = eval_answer.split("3) 注意事項", 1)[0].strip()

                    faithfulness_result = evaluate_faithfulness(
                        question=clean_q,
                        answer=eval_answer,
                        contexts=contexts,
                    )
                    
                    # =========================================
# Save Faithfulness Eval Log
# =========================================

                    try:
                        from db import get_connection

                        with get_connection() as conn:
                            cur = conn.cursor()

                            cur.execute("""
                                INSERT INTO agent.RagEvalLog
                                (
                                    ConversationId,
                                    UserId,
                                    Question,
                                    RagMode,
                                    Faithfulness,
                                    SupportedClaims,
                                    TotalClaims,
                                    EvalJson
                                )
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            str(conversation_id) if conversation_id else None,
                            user_id,
                            clean_q,
                            req.rag_mode,
                            faithfulness_result.get("faithfulness"),
                            faithfulness_result.get("supported_claims"),
                            faithfulness_result.get("total_claims"),
                            json.dumps(faithfulness_result, ensure_ascii=False)
                            )

                            conn.commit()

                    except Exception as e:
                        print("Save RagEvalLog failed:", e)

                    print("\n==============================")
                    print("FAITHFULNESS RESULT")
                    print(json.dumps(faithfulness_result, ensure_ascii=False, indent=2))
                    print("==============================\n")

            except Exception as e:
                print("Faithfulness eval failed:", e)

            reply = ChatMessage(role="assistant", type="text", content=ans_text_out)
            append_messages(session, [reply])

            add_message(
                conversation_id=conversation_id,
                role="assistant",
                content=ans_text_out,
                attachments_json=None,
                sources=raw_sources,
                user_id=user_id,
                source="s2x",
            )

            set_conversation_title_if_empty(conversation_id, _title_seed(clean_q, 80))

            resources = _build_resources(raw_sources)

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
            append_messages(session, [reply])

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

        # 1) 先解析 URL 並索引（讓 doc_rag 真的找得到）
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

        # 2) 讓「解析結果」進入回答的核心（放在問題上方當 context）
        if url_digest_text:
            clean_q_for_answer = (
                f"{url_digest_text}\n\n"
                f"---\n"
                f"【使用者問題】{clean_q}\n"
                f"請把上面「已解析網址/摘要」視為證據，優先用於 1) 直接回答。"
            )
        else:
            clean_q_for_answer = clean_q

        # 3) 用 doc_rag（命中才會引用 doc/網址 chunk）
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

        dialog_state = _build_dialog_state(clean_q, session)

        print("DEBUG dialog_state =", dialog_state)

        ans_text, sources = answer_with_doc_rag(
            clean_q_for_answer,
            session,
            has_fresh_uploads=has_fresh_uploads,
            dialog_state=dialog_state,
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

        # =========================================
        # Faithfulness Evaluation
        # =========================================

        faithfulness_result = None

        try:
            contexts = []

            for s in raw_sources or []:
                text = (
                    s.get("snippet")
                    or s.get("text")
                    or s.get("content")
                    or ""
                )

                if text:
                    contexts.append({
    "title": getattr(r, "title", ""),
    "page": getattr(r, "page", ""),
    "source_type": getattr(r, "source_type", ""),
    "text": str(text),
})

            if contexts:
                # 只評估「1) 綜合回答」，不要把學習重點、注意事項、延伸問題算進去
                eval_answer = final_answer

                if "2) 骨骼學習重點" in eval_answer:
                    eval_answer = eval_answer.split("2) 骨骼學習重點", 1)[0].strip()
                elif "3) 注意事項" in eval_answer:
                    eval_answer = eval_answer.split("3) 注意事項", 1)[0].strip()

                faithfulness_result = evaluate_faithfulness(
                    question=clean_q,
                    answer=eval_answer,
                    contexts=contexts,
                )
                
                # =========================================
# Save Faithfulness Eval Log
# =========================================

                try:
                    from db import get_connection

                    with get_connection() as conn:
                        cur = conn.cursor()

                        cur.execute("""
                            INSERT INTO agent.RagEvalLog
                            (
                                ConversationId,
                                UserId,
                                Question,
                                RagMode,
                                Faithfulness,
                                SupportedClaims,
                                TotalClaims,
                                EvalJson
                            )
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        str(conversation_id) if conversation_id else None,
                        user_id,
                        clean_q,
                        req.rag_mode,
                        faithfulness_result.get("faithfulness"),
                        faithfulness_result.get("supported_claims"),
                        faithfulness_result.get("total_claims"),
                        json.dumps(faithfulness_result, ensure_ascii=False)
                        )

                        conn.commit()

                except Exception as e:
                    print("Save RagEvalLog failed:", e)

                print("\n==============================")
                print("FAITHFULNESS RESULT")
                print(json.dumps(faithfulness_result, ensure_ascii=False, indent=2))
                print("==============================\n")

        except Exception as e:
            print("Faithfulness eval failed:", e)

        # 問題很短時...
        if len(clean_q) <= 2:
            filtered_sources = []

            # 同義詞 / 簡寫 群組
            synonym_groups = [
                ["血友病"],
                ["骨質疏鬆", "骨鬆", "骨質疏松"],
                ["停經", "更年期", "停經後"],
                ["糖尿病", "糖尿"],
                ["退化性關節炎", "退化", "關節退化", "關節炎"],
                ["高血壓", "血壓高"],
                ["骨折", "斷掉", "裂掉"]
            ]

            matched_terms = []
            for group in synonym_groups:
                if any(term in clean_q for term in group):
                    matched_terms.extend(group)

            for s in raw_sources or []:
                blob = " ".join([
                    str(s.get("title") or ""),
                    str(s.get("snippet") or ""),
                    str(s.get("text") or ""),
                ]).lower()

                # 有抓到主題詞時，來源只要命中任一同義詞就保留
                if matched_terms and not any(term.lower() in blob for term in matched_terms):
                    continue

                filtered_sources.append(s)

            # 保底：如果過濾完是空的，就不要覆蓋原本 sources
            if filtered_sources:
                sources = filtered_sources

        resources = _build_resources(sources)

        reply = ChatMessage(role="assistant", type="text", content=ans_text_out)
        append_messages(session, [reply])

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


@app.get("/agent/conversations/{conversation_id}/messages")
def api_get_conversation_messages(conversation_id: str):
    rows = get_messages(conversation_id)

    messages: list[ChatMessage] = []
    resources_by_msg_index: dict[int, list[ChatResource]] = {}
    image_payload_by_msg_index: dict[int, dict] = {}

    for idx, r in enumerate(rows):
        role = r.get("Role") or r.get("role")
        content = r.get("Content") or r.get("content") or ""
        attachments_json = (
            r.get("AttachmentsJson")
            or r.get("attachments_json")
            or r.get("attachments")
        )
        image_case_id = r.get("ImageCaseId") or r.get("image_case_id")

        meta_json = r.get("MetaJson") or r.get("meta_json") or r.get("meta")
        sources_raw = None

        if meta_json:
            try:
                meta_obj = json.loads(meta_json) if isinstance(meta_json, str) else meta_json
                if isinstance(meta_obj, dict):
                    sources_raw = meta_obj.get("sources")
            except Exception:
                sources_raw = None

        url = None
        filetype = None

        if attachments_json:
            try:
                att = json.loads(attachments_json)
                url = att.get("url")
                filetype = att.get("filetype")
            except Exception:
                pass

        payload = None
        if image_case_id:
            payload = _get_image_case_payload(int(image_case_id), top_k=50)
            if payload:
                if not url:
                    url = payload.get("url")
                if not filetype:
                    filetype = payload.get("filetype")

        m = ChatMessage(
            role=role,
            type="text",
            content=content,
            url=url,
            filetype=filetype,
        )
        messages.append(m)

        if payload:
            image_payload_by_msg_index[idx] = payload

        if role == "assistant" and isinstance(sources_raw, list):
            resources_by_msg_index[idx] = _build_resources(sources_raw)

    cid = session_to_conversation_uuid(str(conversation_id))
   

    return {
        "messages": messages,
        "actions": [],
        "conversation_id": cid,
        "resources_by_msg_index": resources_by_msg_index,
        "image_payload_by_msg_index": image_payload_by_msg_index,
    }
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
@app.get("/image-case/{image_case_id}/image")
def api_get_image_case_image(image_case_id: int):
    sql = """
        SELECT TOP 1
            bi.image_path,
            bi.content_type,
            bi.image_data
        FROM vision.ImageCase ic
        JOIN dbo.Bone_Images bi
            ON ic.BoneImageId = bi.image_id
        WHERE ic.ImageCaseId = ?
    """
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, image_case_id)
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
def _get_image_case_payload(case_id: int | None, top_k: int = 50) -> dict | None:
    if not case_id:
        return None

    # 1) 圖片
    img_sql = """
    SELECT TOP 1
        ic.ImageCaseId,
        bi.image_path,
        bi.content_type
    FROM vision.ImageCase ic
    JOIN dbo.Bone_Images bi
        ON ic.BoneImageId = bi.image_id
    WHERE ic.ImageCaseId = ?
    """

    # 2) detections
    det_sql = f"""
    SELECT TOP ({int(top_k)})
        d.DetectionId,
        d.ImageCaseId,
        d.BoneId,
        d.SmallBoneId,
        d.Label41,
        d.Confidence,
        d.X1, d.Y1, d.X2, d.Y2,
        d.PolyJson,
        d.P1X, d.P1Y,
        d.P2X, d.P2Y,
        d.P3X, d.P3Y,
        d.P4X, d.P4Y,
        d.PolyIsNormalized,
        d.Cx, d.Cy,
        b.bone_zh,
        b.bone_en
    FROM vision.ImageDetection d
    LEFT JOIN dbo.Bone_Info b
        ON d.BoneId = b.bone_id
    WHERE d.ImageCaseId = ?
    ORDER BY d.Confidence DESC
    """

    with get_connection() as conn:
        cur = conn.cursor()

        cur.execute(img_sql, case_id)
        img_row = cur.fetchone()
        if not img_row:
            return None

        image_url = (getattr(img_row, "image_path", None) or "").strip()
        filetype = (getattr(img_row, "content_type", None) or "").strip() or None

        cur.execute(det_sql, case_id)
        det_rows = cur.fetchall()

    detections = []
    for row in det_rows:
        detections.append({
            "detection_id": getattr(row, "DetectionId", None),
            "image_case_id": getattr(row, "ImageCaseId", None),
            "bone_id": getattr(row, "BoneId", None),
            "small_bone_id": getattr(row, "SmallBoneId", None),
            "bone_zh": getattr(row, "bone_zh", None),
            "bone_en": getattr(row, "bone_en", None),
            "label41": getattr(row, "Label41", None),
            "confidence": float(getattr(row, "Confidence", 0.0) or 0.0),
            "bbox": [
                getattr(row, "X1", None),
                getattr(row, "Y1", None),
                getattr(row, "X2", None),
                getattr(row, "Y2", None),
            ],
            "PolyJson": getattr(row, "PolyJson", None),
            "P1X": getattr(row, "P1X", None),
            "P1Y": getattr(row, "P1Y", None),
            "P2X": getattr(row, "P2X", None),
            "P2Y": getattr(row, "P2Y", None),
            "P3X": getattr(row, "P3X", None),
            "P3Y": getattr(row, "P3Y", None),
            "P4X": getattr(row, "P4X", None),
            "P4Y": getattr(row, "P4Y", None),
            "PolyIsNormalized": getattr(row, "PolyIsNormalized", None),
            "Cx": getattr(row, "Cx", None),
            "Cy": getattr(row, "Cy", None),
        })

    return {
        "image_case_id": case_id,
        "url": image_url,
        "filetype": filetype,
        "detections": detections,
    }