from __future__ import annotations

import os
import re


from typing import Any, Dict, List, Tuple

from openai import OpenAI
from qdrant_client import QdrantClient
from qdrant_client.http.exceptions import UnexpectedResponse
from .doc_tool import retrieve as doc_retrieve, is_enabled as doc_rag_enabled


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

def _is_guid_like(v: Any) -> bool:
    if v is None:
        return False
    s = str(v).strip()
    return bool(_GUID_RE.fullmatch(s))



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





def _is_https_url(v: Any) -> bool:
    if v is None:
        return False
    s = str(v).strip()
    return s.startswith("https://")

def _sanitize_for_llm(text: str) -> str:
    s = str(text or "")

    # 去掉 NUL
    s = s.replace("\x00", " ")

    # 去掉大多數控制字元，但保留 \n \t
    s = re.sub(r"[\x01-\x08\x0b\x0c\x0e-\x1f]", " ", s)

    # 去掉不合法 surrogate，避免 JSON / UTF-8 爆掉
    s = s.encode("utf-8", "ignore").decode("utf-8", "ignore")

    # 保守再清一次常見非字元區
    s = re.sub(r"[\ud800-\udfff]", "", s)

    # 收斂空白
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)

    return s.strip()

def _embed(text: str) -> List[float]:
    text = (text or "").strip()
    if not text:
        return []
    r = client.embeddings.create(model=EMBEDDING_MODEL, input=text)
    return r.data[0].embedding

def _build_retrieval_query(user_q: str, session: dict | None, keep_last_user: int = 3) -> str:
    user_q = _expand_query_aliases((user_q or "").strip())
    if not session:
        return user_q

    msgs = session.get("messages") or []
    if not isinstance(msgs, list):
        return user_q

    recent_user_texts: List[str] = []

    for m in msgs[-10:]:
        if isinstance(m, dict):
            role = m.get("role")
            content = m.get("content")
            msg_type = m.get("type")
        else:
            role = getattr(m, "role", None)
            content = getattr(m, "content", None)
            msg_type = getattr(m, "type", None)

        if role != "user":
            continue
        if msg_type and msg_type != "text":
            continue

        content_str = str(content or "").strip()
        if not content_str:
            continue

        recent_user_texts.append(content_str)

    if not recent_user_texts:
        return user_q

    recent_user_texts = recent_user_texts[-keep_last_user:]

    # 避免把當前問題重複兩次
    if recent_user_texts and recent_user_texts[-1] == user_q:
        recent_user_texts = recent_user_texts[:-1]

    merged = " ".join([*recent_user_texts, user_q]).strip()
    return merged or user_q

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

    # upload 不要進參考資料可點連結
    if source_type == "upload":
        base_view_path = None
        base_download_path = None
        external_url = None
    elif safe_material_id:
        base_view_path = f"/s2/llm/materials/{safe_material_id}/view"
        base_download_path = f"/s2/llm/materials/{safe_material_id}/download"
        external_url = raw_url if _is_https_url(raw_url) else None
    else:
        # 外部網站 / 其他可公開網址
        base_view_path = raw_url if raw_url and not re.search(r"/uploads/", raw_url, re.I) else None
        base_download_path = raw_url if raw_url and not re.search(r"/uploads/", raw_url, re.I) else None
        external_url = raw_url if _is_https_url(raw_url) else None

    raw_snippet = payload.get("snippet") or payload.get("text") or payload.get("content") or ""
    snippet = ""

    if isinstance(raw_snippet, str):
        text = re.sub(r"\s+", " ", raw_snippet).strip()
        text = re.sub(r"^(?:[\d\.\-\+\(\)\/%\sA-Za-z]{1,120})", "", text).strip()

        candidates = [
    "骨質疏鬆",
    "骨鬆",
    "骨質"
    "骨值疏鬆",
    "骨質疏松",
    "骨質密度",
    "診斷",
    "治療",
    "預防",
    "症狀",
    "檢測",
    "DXA",
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

def _build_history_context(session: dict | None, keep_last: int = 6) -> str:
    if not session:
        return ""

    msgs = session.get("messages") or []
    if not isinstance(msgs, list):
        return ""

    picked: List[str] = []

    for m in msgs[-keep_last:]:
        if isinstance(m, dict):
            role = m.get("role")
            content = m.get("content")
            msg_type = m.get("type")
        else:
            role = getattr(m, "role", None)
            content = getattr(m, "content", None)
            msg_type = getattr(m, "type", None)

        if role not in {"user", "assistant"}:
            continue
        if msg_type and msg_type != "text":
            continue

        content_str = str(content or "").strip()
        if not content_str:
            continue

        picked.append(f"{role}: {content_str}")

    if not picked:
        return ""

    return "\n".join(picked)


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


def answer_with_rag(user_q: str, session: dict | None = None) -> Tuple[str, List[Dict[str, Any]]]:
    user_q = (user_q or "").strip()
    if not user_q:
        return "你問的內容是空的，我沒辦法檢索。請再輸入一次。", []

    retrieval_query = _build_retrieval_query(user_q, session, keep_last_user=3)
    sources = retrieve_sources(retrieval_query)
    print("✅ NEW RAG FILE LOADED")
    print("DEBUG retrieval_query =", retrieval_query)

    # 第一次沒命中，再退回用原問題搜一次，避免 history 反而把 query 弄髒
    if not sources and retrieval_query != user_q:
        sources = retrieve_sources(user_q)
        print("DEBUG fallback retrieval_query =", user_q)

    if not sources:
        return (
            "我目前沒有在教材參考資料中找到足夠匹配的內容，因此暫時無法直接根據現有資料回答你。\n\n"
            "可能原因包括：\n"
            "1) 目前教材庫裡尚未收錄這個主題\n"
            "2) 你的問題用詞和教材中的寫法不同，因此沒有成功對應到相關段落\n"
            "3) 前面的對話脈絡影響了查詢詞，讓檢索方向偏離原本問題\n\n"
            "為了避免我根據不完整資訊做出不可靠的推論，這裡先不直接生成結論；實際內容仍應以檢索到的教材參考資料為準。\n\n"
            "你可以改用更具體的關鍵字再試一次，例如：\n"
            "・肋骨骨折 症狀\n"
            "・脛骨骨折 固定方式\n"
            "・腕骨 組成\n\n"
            "也可以直接上傳 PDF 或教材檔案，讓我優先根據你這次提供的內容回答（不建立索引、不影響原本向量庫）。\n",
            []
        )

    context_lines = []
    for i, s in enumerate(sources, 1):
        name = s.get("display_title") or s.get("title") or f"source-{i}"
        snippet = s.get("snippet") or ""
        context_lines.append(f"[#{i}] {name}\n{snippet}")

    context = "\n\n".join(context_lines)
    history_context = _build_history_context(session, keep_last=6)

    system = (
        "你是骨科衛教/判讀輔助的助手。你只能根據【提供的檢索片段】回答。\n"
        "如果片段不足以支持結論，可以搜尋其他網站，如果沒查到必須說『資料不足』，並提出需要的補充資訊。\n"
        "回答要清楚、專業口語化、可直接給老師看。\n"
        "不要在正文中輸出 source、【Sources】、【參考資料】、來源編號、score、頁碼或任何引用清單。\n"
        "若使用者問題像是追問，請優先結合【最近對話歷史】理解主詞與上下文。\n"
    )

    prompt = (
        f"【最近對話歷史】\n{history_context or '（無）'}\n\n"
        f"【使用者問題】\n{user_q}\n\n"
        f"【檢索片段（可引用）】\n{context}\n\n"
        "請輸出：\n"
        "1) 知識庫回答\n"
        "2) 判讀/衛教重點（專業的敘述，請列點敘述）\n"
        "3) 注意事項（你不確定就說不確定）\n"
        "不要輸出 Sources、參考資料、來源編號、score、頁碼。\n"
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
    
    
def _is_material_source(s: Dict[str, Any]) -> bool:
    if not isinstance(s, dict):
        return False

    source_type = (s.get("source_type") or s.get("kind") or "").strip().lower()

    # upload 只供回答，不進參考資料區
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

        # upload 可回答，但不要進參考資料區
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
            # 非教材 GUID：只允許公開 https 網址
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

def answer_with_doc_rag(
    user_q: str,
    session: dict | None = None,
    has_fresh_uploads: bool = False,
) -> Tuple[str, List[Dict[str, Any]]]:
    user_q = (user_q or "").strip()
    if not user_q:
        return "你問的內容是空的，我沒辦法檢索。請再輸入一次。", []

    retrieval_query = _build_retrieval_query(user_q, session, keep_last_user=3)
    history_context = _build_history_context(session, keep_last=6)

    doc_sources_raw: List[Dict[str, Any]] = []
    vector_sources: List[Dict[str, Any]] = []

    # 1) 有新上傳檔案時，先查 doc/file
    if doc_rag_enabled() and has_fresh_uploads:
        try:
            doc_sources_raw = doc_retrieve(retrieval_query, top_k=TOP_K)
            if not doc_sources_raw and retrieval_query != user_q:
                doc_sources_raw = doc_retrieve(user_q, top_k=TOP_K)
        except Exception as e:
            print(f"❌ doc_rag retrieve error: {e}")
            doc_sources_raw = []

    # 2) 不管有沒有新檔，都查既有向量知識庫當補充
    try:
        vector_sources = retrieve_sources(retrieval_query, top_k=TOP_K)
        if not vector_sources and retrieval_query != user_q:
            vector_sources = retrieve_sources(user_q, top_k=TOP_K)
    except Exception as e:
        print(f"❌ vector_rag retrieve error: {e}")
        vector_sources = []

    # 3) 給 LLM 的上下文：doc + vector 混合
    context_lines: List[str] = []

    for i, s in enumerate(doc_sources_raw, 1):
        context_lines.append(f"【上傳檔案來源 #{i}】\n{_doc_source_to_prompt_block(s, i)}")

    for i, s in enumerate(vector_sources, 1):
        title = _sanitize_for_llm(s.get("display_title") or s.get("title") or f"kb-{i}")
        snippet = _sanitize_for_llm(s.get("snippet") or "")
        context_lines.append(f"【知識庫來源 #{i}】\n[{title}]\n{snippet}")

    # 4) 前端參考資料：只顯示可公開/教材來源，不顯示 upload
    doc_resources = _normalize_doc_sources(doc_sources_raw)
    merged_resources = doc_resources + vector_sources

    # 去重：優先用 material_id，其次 url/title
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
        return answer_with_rag(user_q, session)

    context = "\n\n".join(context_lines)

    system = (
        "你是骨科衛教/判讀輔助的助手。你只能根據【提供的檢索片段】回答。\n"
        "若上傳檔案內容不足，請優先再結合既有知識庫片段補充，不要只因檔案沒寫就直接結束。\n"
        "如果整體片段仍不足以支持結論，必須明確說資料不足，不要自行腦補。\n"
        "回答要清楚、專業口語化、可直接給老師看。\n"
        "不要在正文中輸出 source、【Sources】、【參考資料】、來源編號、score、頁碼或任何引用清單。\n"
        "若使用者問題像是追問，請優先結合【最近對話歷史】理解主詞與上下文。\n"
    )

    prompt = (
        f"【最近對話歷史】\n{history_context or '（無）'}\n\n"
        f"【使用者問題】\n{user_q}\n\n"
        f"【檢索片段（可引用，含上傳檔案與既有知識庫）】\n{context}\n\n"
        "請輸出：\n"
        "1) 綜合回答\n"
        "2) 判讀/衛教重點（列點）\n"
        "3) 注意事項（你不確定就說不確定）\n"
        "若上傳檔案沒有直接答案，但知識庫有相關內容，請明確補充說明。\n"
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
        print("DEBUG doc_sources =", len(doc_sources_raw))
        print("DEBUG vector_sources =", len(vector_sources))

        return ans.strip(), deduped_resources

    except Exception as e:
        print(f"❌ HYBRID DOC+VECTOR RAG answer failed: {e}")
        return "檢索有命中，但生成回答時發生錯誤（請看後端 log）。", deduped_resources