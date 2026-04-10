from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Tuple, Optional

from openai import OpenAI
from qdrant_client import QdrantClient
from qdrant_client.http.exceptions import UnexpectedResponse
from .doc_tool import retrieve as doc_retrieve, is_enabled as doc_rag_enabled
from functools import lru_cache

@lru_cache(maxsize=512)
def _embed_cached(text: str) -> tuple[float, ...]:
    text = (text or "").strip()
    if not text:
        return tuple()
    r = client.embeddings.create(model=EMBEDDING_MODEL, input=text)
    return tuple(r.data[0].embedding)

def _embed(text: str) -> List[float]:
    return list(_embed_cached((text or "").strip()))

QDRANT_URL = os.getenv("QDRANT_URL", "http://127.0.0.1:6333")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "bone_edu_docs")

EMBEDDING_MODEL = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
TOP_K = int(os.getenv("RAG_TOP_K", "6"))
MIN_RAG_SCORE = float(os.getenv("RAG_MIN_SCORE", "0.55"))

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
qdrant = (
    QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)
    if QDRANT_API_KEY
    else QdrantClient(url=QDRANT_URL)
)

_GUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)

FOLLOWUP_HINTS = [
    "那", "那個", "這個", "這種", "上述", "剛剛", "前面", "前述", "因此", "所以",
    "然後", "接著", "它", "他", "她", "其", "該", "會嗎", "怎麼辦", "怎麼治療",
]

INTENT_KEYWORDS = {
    "definition": ["是什麼", "什麼是", "定義", "介紹", "說明"],
    "symptom": ["症狀", "表現", "徵象", "感覺", "會痛嗎", "痛嗎"],
    "cause": ["原因", "為什麼", "成因", "造成", "導致"],
    "risk": ["高風險", "危險因子", "風險", "容易", "好發", "誰比較容易"],
    "exam": ["檢查", "怎麼檢查", "檢測", "診斷", "骨密度", "DXA", "X光", "掃描"],
    "treatment": ["治療", "怎麼治療", "如何治療", "處理", "開刀", "手術", "藥物"],
    "prevention": ["預防", "避免", "保養", "保健"],
    "comparison": ["差異", "比較", "不同", "差別"],
    "upload_analysis": ["這份檔案", "這個檔案", "這張圖", "這份報告", "這個圖片"],
}

TOPIC_HINTS = [
    "骨質疏鬆", "骨鬆", "骨質疏松",
    "血友病",
    "停經", "更年期", "停經後",
    "糖尿病", "糖尿",
    "退化性關節炎", "關節炎", "關節退化",
    "高血壓", "血壓高",
    "骨折", "肋骨骨折", "脛骨骨折", "腕骨",
    "骨密度", "DXA",
    "痛風", "高尿酸", "尿酸"
]


def _is_guid_like(v: Any) -> bool:
    if v is None:
        return False
    s = str(v).strip()
    return bool(_GUID_RE.fullmatch(s))


def _is_https_url(v: Any) -> bool:
    if v is None:
        return False
    s = str(v).strip()
    return s.startswith("https://")


def _sanitize_for_llm(text: str) -> str:
    s = str(text or "")
    s = s.replace("\x00", " ")
    s = re.sub(r"[\x01-\x08\x0b\x0c\x0e-\x1f]", " ", s)
    s = s.encode("utf-8", "ignore").decode("utf-8", "ignore")
    s = re.sub(r"[\ud800-\udfff]", "", s)
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def _expand_query_aliases(q: str) -> str:
    q = (q or "").strip()
    if not q:
        return q

    synonym_groups = [
        ["骨質疏鬆", "骨鬆", "骨質疏松"],
        ["血友病"],
        ["停經", "更年期", "停經後"],
        ["糖尿病", "糖尿"],
        ["退化性關節炎", "退化", "關節退化", "關節炎"],
        ["高血壓", "血壓高"],
        ["骨折", "斷掉", "裂掉"],
        ["骨密度", "DXA"],
        ["痛風", "高尿酸", "尿酸"],
    ]

    expanded = []
    for group in synonym_groups:
        if any(term in q for term in group):
            expanded.extend(group)

    seen = set()
    merged = []
    for term in [q] + expanded:
        if term not in seen:
            seen.add(term)
            merged.append(term)

    return " ".join(merged)


def _embed(text: str) -> List[float]:
    text = (text or "").strip()
    if not text:
        return []
    r = client.embeddings.create(model=EMBEDDING_MODEL, input=text)
    return r.data[0].embedding


def _get_session_messages(session: dict | None, keep_last: int = 12) -> List[Dict[str, Any]]:
    if not session:
        return []

    msgs = session.get("messages") or []
    if not isinstance(msgs, list):
        return []

    out: List[Dict[str, Any]] = []
    for m in msgs[-keep_last:]:
        if isinstance(m, dict):
            role = m.get("role")
            content = m.get("content")
            msg_type = m.get("type")
            url = m.get("url")
        else:
            role = getattr(m, "role", None)
            content = getattr(m, "content", None)
            msg_type = getattr(m, "type", None)
            url = getattr(m, "url", None)

        if role not in {"user", "assistant"}:
            continue

        out.append({
            "role": role,
            "content": str(content or "").strip(),
            "type": msg_type,
            "url": url,
        })

    return out


def _infer_intent(text: str) -> str:
    t = str(text or "").strip()
    if not t:
        return "general"

    for intent, kws in INTENT_KEYWORDS.items():
        if any(kw in t for kw in kws):
            return intent

    return "general"


def _infer_topic_from_text(text: str) -> str:
    t = str(text or "").strip()
    if not t:
        return ""

    for kw in TOPIC_HINTS:
        if kw in t:
            return kw

    return ""


def _looks_like_followup(text: str) -> bool:
    t = str(text or "").strip()
    if not t:
        return False

    if len(t) <= 12:
        return True

    return any(h in t for h in FOLLOWUP_HINTS)


def _build_dialog_state(user_q: str, session: dict | None) -> Dict[str, Any]:
    msgs = _get_session_messages(session, keep_last=12)

    recent_user = [m["content"] for m in msgs if m["role"] == "user" and m["content"]]
    recent_assistant = [m["content"] for m in msgs if m["role"] == "assistant" and m["content"]]

    current_intent = _infer_intent(user_q)
    current_topic = _infer_topic_from_text(user_q)

    if not current_topic:
        for text in reversed(recent_user[-5:]):
            topic = _infer_topic_from_text(text)
            if topic:
                current_topic = topic
                break

    if not current_topic:
        for text in reversed(recent_assistant[-3:]):
            topic = _infer_topic_from_text(text)
            if topic:
                current_topic = topic
                break

    is_followup = _looks_like_followup(user_q)
    followup_target = current_topic or ""

    recent_points: List[str] = []
    for t in recent_user[-4:]:
        intent = _infer_intent(t)
        topic = _infer_topic_from_text(t)
        frag = " / ".join([x for x in [topic, intent if intent != "general" else ""] if x]).strip()
        if frag and frag not in recent_points:
            recent_points.append(frag)

    state = {
        "current_topic": current_topic,
        "current_intent": current_intent,
        "is_followup": is_followup,
        "followup_target": followup_target,
        "recent_points": recent_points[-4:],
        "recent_user_questions": recent_user[-4:],
    }

    return state


def _build_retrieval_query(user_q: str, session: dict | None, dialog_state: Optional[Dict[str, Any]] = None) -> str:
    state = dialog_state or _build_dialog_state(user_q, session)

    topic = str(state.get("current_topic") or "").strip()
    intent = str(state.get("current_intent") or "").strip()

    intent_map = {
        "definition": "定義 介紹 說明",
        "symptom": "症狀 臨床表現 徵象",
        "cause": "原因 成因 危險因子",
        "risk": "高風險 危險因子 好發族群",
        "exam": "檢查 診斷 骨密度 DXA",
        "treatment": "治療 處置 藥物 手術",
        "prevention": "預防 保健",
        "comparison": "比較 差異",
        "upload_analysis": "檔案 圖片 報告 解釋",
        "general": "",
    }

    parts: List[str] = []

    if topic:
        parts.append(topic)

    if intent and intent in intent_map and intent_map[intent]:
        parts.append(intent_map[intent])

    parts.append(user_q)

    merged = " ".join([p for p in parts if p]).strip()
    merged = _expand_query_aliases(merged)
    return merged


def _build_history_summary(user_q: str, session: dict | None, dialog_state: Optional[Dict[str, Any]] = None) -> str:
    state = dialog_state or _build_dialog_state(user_q, session)
    msgs = _get_session_messages(session, keep_last=10)

    lines: List[str] = []

    topic = state.get("current_topic") or "未明確主題"
    intent = state.get("current_intent") or "general"
    is_followup = bool(state.get("is_followup"))

    lines.append(f"目前主題：{topic}")
    lines.append(f"本次需求類型：{intent}")
    lines.append(f"是否屬於追問：{'是' if is_followup else '否'}")

    recent_points = state.get("recent_points") or []
    if recent_points:
        lines.append("近期對話焦點：" + "；".join(recent_points))

    recent_pairs: List[str] = []
    for m in msgs[-6:]:
        role = m.get("role")
        content = str(m.get("content") or "").strip()
        if not content:
            continue
        if len(content) > 80:
            content = content[:80] + "…"
        recent_pairs.append(f"{role}: {content}")

    if recent_pairs:
        lines.append("最近對話摘錄：")
        lines.extend(recent_pairs)

    return "\n".join(lines).strip()


def _payload_to_source(payload: Dict[str, Any], score: float) -> Dict[str, Any]:
    raw_title = (
        payload.get("title")
        or payload.get("file")
        or payload.get("filename")
        or payload.get("source")
        or "未命名教材"
    )

    page = payload.get("page") or payload.get("pageno") or payload.get("page_no")
    chunk = payload.get("chunk") or payload.get("chunk_id") or payload.get("chunk_index")

    raw_material_id = payload.get("material_id")
    material_id = str(raw_material_id).strip() if raw_material_id is not None else None
    safe_material_id = material_id if _is_guid_like(material_id) else None

    raw_url = str(
        payload.get("url")
        or payload.get("download_url")
        or payload.get("file_url")
        or payload.get("path")
        or ""
    ).strip()

    source_type = str(payload.get("source_type") or payload.get("kind") or payload.get("type") or "qdrant").strip().lower()

    if source_type == "upload":
        base_view_path = None
        base_download_path = None
        external_url = None
    elif safe_material_id:
        base_view_path = f"/s2/llm/materials/{safe_material_id}/view"
        base_download_path = f"/s2/llm/materials/{safe_material_id}/download"
        external_url = raw_url if _is_https_url(raw_url) else None
    else:
        base_view_path = raw_url if raw_url and not re.search(r"/uploads/", raw_url, re.I) else None
        base_download_path = raw_url if raw_url and not re.search(r"/uploads/", raw_url, re.I) else None
        external_url = raw_url if _is_https_url(raw_url) else None

    raw_snippet = payload.get("snippet") or payload.get("text") or payload.get("content") or ""
    snippet = ""

    if isinstance(raw_snippet, str):
        text = re.sub(r"\s+", " ", raw_snippet).strip()
        text = re.sub(r"^(?:[\d\.\-\+\(\)\/%\sA-Za-z]{1,120})", "", text).strip()

        candidates = [
            "骨質疏鬆", "骨鬆", "骨質", "骨值疏鬆", "骨質疏松", "骨質密度",
            "診斷", "治療", "預防", "症狀", "檢測", "DXA",
        ]

        cut_pos = None
        for kw in candidates:
            pos = text.find(kw)
            if pos != -1 and pos < 400:
                cut_pos = pos
                break

        if cut_pos is not None:
            text = text[cut_pos:]

        snippet = text[:160]
        if len(text) > 160:
            snippet += "…"

    return {
        "title": raw_title,
        "display_title": raw_title,
        "page": page,
        "chunk": chunk,
        "url": base_view_path,
        "download_url": base_download_path,
        "external_url": external_url,
        "score": float(score) if score is not None else None,
        "snippet": snippet,
        "kind": source_type,
        "material_id": material_id,
        "source_type": source_type,
    }


def retrieve_sources(query: str, top_k: int = TOP_K) -> List[Dict[str, Any]]:
    vec = _embed(query)
    if not vec:
        return []

    try:
        fetch_k = max(top_k * 3, top_k)

        if hasattr(qdrant, "search"):
            hits = qdrant.search(
                collection_name=QDRANT_COLLECTION,
                query_vector=vec,
                limit=fetch_k,
                with_payload=True,
                with_vectors=False,
            )
        elif hasattr(qdrant, "query_points"):
            try:
                resp = qdrant.query_points(
                    collection_name=QDRANT_COLLECTION,
                    query_vector=vec,
                    limit=fetch_k,
                    with_payload=True,
                    with_vectors=False,
                )
            except Exception:
                resp = qdrant.query_points(
                    collection_name=QDRANT_COLLECTION,
                    query=vec,
                    limit=fetch_k,
                    with_payload=True,
                    with_vectors=False,
                )
            hits = getattr(resp, "points", resp)
        else:
            raise RuntimeError("Unsupported qdrant-client: no search/query_points")

    except UnexpectedResponse as e:
        print(f"❌ Qdrant search failed: {e}")
        return []
    except Exception as e:
        print(f"❌ Qdrant search error: {e}")
        return []

    raw_sources: List[Dict[str, Any]] = []
    for h in hits:
        score = float(getattr(h, "score", 0) or 0)
        if score < MIN_RAG_SCORE:
            continue
        payload = h.payload or {}
        raw_sources.append(_payload_to_source(payload, score))

    raw_sources.sort(key=lambda x: x.get("score") or 0, reverse=True)

    deduped: List[Dict[str, Any]] = []
    seen = set()

    for s in raw_sources:
        key = (
            s.get("material_id") or s.get("file") or s.get("title"),
            s.get("page"),
            s.get("chunk"),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(s)

        if len(deduped) >= top_k:
            break

    return deduped


def _is_material_source(s: Dict[str, Any]) -> bool:
    if not isinstance(s, dict):
        return False

    source_type = (s.get("source_type") or s.get("kind") or "").strip().lower()

    if source_type == "upload":
        return False

    raw_material_id = s.get("material_id")

    if source_type in {"material", "teaching_material", "db_material", "doc_index", "qdrant", "url"}:
        return True

    if raw_material_id:
        return True

    return False


def _doc_source_to_prompt_block(s: Dict[str, Any], idx: int) -> str:
    title = _sanitize_for_llm(s.get("title") or f"doc-{idx}")
    text = _sanitize_for_llm(s.get("text") or "")
    snippet = re.sub(r"\s+", " ", text)[:500].strip()
    return f"[#{idx}] {title}\n{snippet}"


def _normalize_doc_sources(doc_sources: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []

    for s in doc_sources or []:
        if not isinstance(s, dict):
            continue

        source_type = (s.get("source_type") or s.get("kind") or "").strip().lower()

        if source_type == "upload":
            continue

        if not _is_material_source(s):
            continue

        text = _sanitize_for_llm(s.get("text") or "")
        snippet = re.sub(r"\s+", " ", text)[:160].strip()
        if len(text) > 160:
            snippet += "…"

        raw_material_id = s.get("material_id")
        material_id = str(raw_material_id).strip() if raw_material_id is not None else None
        safe_material_id = material_id if _is_guid_like(material_id) else None

        raw_url = str(
            s.get("url")
            or s.get("download_url")
            or s.get("file_url")
            or s.get("path")
            or ""
        ).strip()

        if safe_material_id:
            view_url = f"/s2/llm/materials/{safe_material_id}/view"
            download_url = f"/s2/llm/materials/{safe_material_id}/download"
            external_url = raw_url if _is_https_url(raw_url) else None
        else:
            if _is_https_url(raw_url):
                view_url = raw_url
                download_url = raw_url
                external_url = raw_url
            else:
                view_url = None
                download_url = None
                external_url = None

        out.append(
            {
                "title": _sanitize_for_llm(s.get("title") or "未命名文件"),
                "display_title": _sanitize_for_llm(s.get("title") or "未命名文件"),
                "page": s.get("page") or s.get("pageno") or s.get("page_no"),
                "chunk": s.get("chunk") or s.get("chunk_id") or s.get("chunk_index"),
                "url": view_url,
                "download_url": download_url,
                "external_url": external_url,
                "score": float(s.get("score") or 0.0),
                "snippet": snippet,
                "kind": source_type,
                "material_id": material_id,
                "source_type": source_type,
                "text": text,
            }
        )

    return out


def answer_with_rag(
    user_q: str,
    session: dict | None = None,
    dialog_state: Optional[Dict[str, Any]] = None,
) -> Tuple[str, List[Dict[str, Any]]]:
    user_q = (user_q or "").strip()
    if not user_q:
        return "你問的內容是空的，我沒辦法檢索。請再輸入一次。", []

    state = dialog_state or _build_dialog_state(user_q, session)
    retrieval_query = _build_retrieval_query(user_q, session, state)
    sources = retrieve_sources(retrieval_query)

    print("✅ NEW RAG FILE LOADED")
    print("DEBUG retrieval_query =", retrieval_query)
    print("DEBUG dialog_state =", state)

    if not sources and retrieval_query != user_q:
        sources = retrieve_sources(user_q)
        print("DEBUG fallback retrieval_query =", user_q)

    if not sources:
        return (
            "我目前沒有在教材參考資料中找到足夠匹配的內容，因此暫時無法直接根據現有資料回答你。\n\n"
            "你可以再換更具體的關鍵字，例如：\n"
            "・肋骨骨折 症狀\n"
            "・脛骨骨折 固定方式\n"
            "・骨質疏鬆 DXA 檢查\n\n"
            "也可以直接上傳 PDF 或教材檔案，讓我優先根據這次提供的內容回答。\n",
            []
        )

    context_lines = []
    for i, s in enumerate(sources, 1):
        name = s.get("display_title") or s.get("title") or f"source-{i}"
        snippet = s.get("snippet") or ""
        context_lines.append(f"[#{i}] {name}\n{snippet}")

    context = "\n\n".join(context_lines)
    history_summary = _build_history_summary(user_q, session, state)

    system = (
        "你是骨科衛教/判讀輔助的助手。\n"
        "你只能根據提供的檢索片段回答，不足就明確說資料不足，不要自行腦補。\n"
        "回答要清楚、專業、口語化，且要讓使用者感覺你有理解他現在真正想問的重點。\n"
        "若使用者問題像是追問，請優先根據『對話狀態摘要』理解主題、代名詞與需求類型。\n"
        "不要在正文中輸出 source、來源編號、score、頁碼或參考資料清單。\n"
    )

    prompt = (
        f"【對話狀態摘要】\n{history_summary or '（無）'}\n\n"
        f"【使用者問題】\n{user_q}\n\n"
        f"【檢索片段】\n{context}\n\n"
        "請輸出：\n"
        "1) 綜合回答\n"
        "2) 判讀/衛教重點（列點）\n"
        "3) 注意事項（不確定就明確說不確定）\n"
        "請優先對準使用者這一輪真正的需求，不要只是重複上一輪內容。\n"
    )

    try:
        chat = client.chat.completions.create(
            model=os.getenv("OPENAI_CHAT_MODEL", "gpt-4o-mini"),
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
        )
        ans = chat.choices[0].message.content or ""
        ans = re.split(
            r"\n[-—–]*\s*\[?\s*(Sources|參考資料|Resources)\s*\]?\s*",
            ans,
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0]
        return ans.strip(), sources
    except Exception as e:
        print(f"❌ LLM answer failed: {e}")
        return "檢索有命中，但生成回答時發生錯誤（請看後端 log）。", sources


def answer_with_doc_rag(
    user_q: str,
    session: dict | None = None,
    has_fresh_uploads: bool = False,
    dialog_state: Optional[Dict[str, Any]] = None,
) -> Tuple[str, List[Dict[str, Any]]]:
    user_q = (user_q or "").strip()
    if not user_q:
        return "你問的內容是空的，我沒辦法檢索。請再輸入一次。", []

    state = dialog_state or _build_dialog_state(user_q, session)
    retrieval_query = _build_retrieval_query(user_q, session, state)
    history_summary = _build_history_summary(user_q, session, state)

    doc_sources_raw: List[Dict[str, Any]] = []
    vector_sources: List[Dict[str, Any]] = []

    if doc_rag_enabled() and has_fresh_uploads:
        try:
            doc_sources_raw = doc_retrieve(retrieval_query, top_k=TOP_K)
            if not doc_sources_raw and retrieval_query != user_q:
                doc_sources_raw = doc_retrieve(user_q, top_k=TOP_K)
        except Exception as e:
            print(f"❌ doc_rag retrieve error: {e}")
            doc_sources_raw = []

    try:
        vector_sources = retrieve_sources(retrieval_query, top_k=TOP_K)
        if not vector_sources and retrieval_query != user_q:
            vector_sources = retrieve_sources(user_q, top_k=TOP_K)
    except Exception as e:
        print(f"❌ vector_rag retrieve error: {e}")
        vector_sources = []

    context_lines: List[str] = []

    for i, s in enumerate(doc_sources_raw, 1):
        context_lines.append(f"【上傳檔案來源 #{i}】\n{_doc_source_to_prompt_block(s, i)}")

    for i, s in enumerate(vector_sources, 1):
        title = _sanitize_for_llm(s.get("display_title") or s.get("title") or f"kb-{i}")
        snippet = _sanitize_for_llm(s.get("snippet") or "")
        context_lines.append(f"【知識庫來源 #{i}】\n[{title}]\n{snippet}")

    doc_resources = _normalize_doc_sources(doc_sources_raw)
    merged_resources = doc_resources + vector_sources

    deduped_resources: List[Dict[str, Any]] = []
    seen = set()
    for s in merged_resources:
        key = (
            s.get("material_id")
            or s.get("url")
            or s.get("download_url")
            or s.get("title")
        )
        if not key or key in seen:
            continue
        seen.add(key)
        deduped_resources.append(s)

    if not context_lines:
        print("DEBUG no doc/vector hit, fallback to vector rag default path")
        return answer_with_rag(user_q, session, dialog_state=state)

    context = "\n\n".join(context_lines)

    system = (
        "你是骨科衛教/判讀輔助的助手。\n"
        "你只能根據提供的檢索片段回答。\n"
        "若上傳檔案內容不足，請再結合知識庫片段補充；若整體片段仍不足，必須明確說資料不足，不要自行腦補。\n"
        "請優先理解使用者這一輪真正需求，並根據『對話狀態摘要』判斷目前主題與追問對象。\n"
        "不要在正文中輸出 source、來源編號、score、頁碼或參考資料清單。\n"
    )

    prompt = (
        f"【對話狀態摘要】\n{history_summary or '（無）'}\n\n"
        f"【使用者問題】\n{user_q}\n\n"
        f"【檢索片段（含上傳檔案與既有知識庫）】\n{context}\n\n"
        "請輸出：\n"
        "1) 綜合回答\n"
        "2) 判讀/衛教重點（列點）\n"
        "3) 注意事項（不確定就明確說不確定）\n"
        "若這一輪是追問，請把代名詞補回真正主題再回答。\n"
        "不要輸出 Sources、參考資料、來源編號、score、頁碼。\n"
    )

    try:
        safe_system = _sanitize_for_llm(system)
        safe_prompt = _sanitize_for_llm(prompt)

        chat = client.chat.completions.create(
            model=os.getenv("OPENAI_CHAT_MODEL", "gpt-4o-mini"),
            messages=[
                {"role": "system", "content": safe_system},
                {"role": "user", "content": safe_prompt},
            ],
            temperature=0.2,
        )
        ans = chat.choices[0].message.content or ""
        ans = re.split(
            r"\n[-—–]*\s*\[?\s*(Sources|參考資料|Resources)\s*\]?\s*",
            ans,
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0]

        print("✅ HYBRID DOC+VECTOR RAG HIT")
        print("DEBUG doc retrieval_query =", retrieval_query)
        print("DEBUG dialog_state =", state)
        print("DEBUG doc_sources =", len(doc_sources_raw))
        print("DEBUG vector_sources =", len(vector_sources))

        return ans.strip(), deduped_resources

    except Exception as e:
        print(f"❌ HYBRID DOC+VECTOR RAG answer failed: {e}")
        return "檢索有命中，但生成回答時發生錯誤（請看後端 log）。", deduped_resources