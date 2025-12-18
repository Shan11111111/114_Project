from __future__ import annotations

import os
from typing import Any, Dict, List, Tuple

from openai import OpenAI

# qdrant-client
from qdrant_client import QdrantClient
from qdrant_client.http.exceptions import UnexpectedResponse


# -----------------------------
# Env
# -----------------------------
QDRANT_URL = os.getenv("QDRANT_URL", "http://127.0.0.1:6333")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")  # optional
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "bone_edu_docs")

EMBEDDING_MODEL = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
TOP_K = int(os.getenv("RAG_TOP_K", "6"))

# OpenAI
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# Qdrant
qdrant = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY) if QDRANT_API_KEY else QdrantClient(url=QDRANT_URL)


def _embed(text: str) -> List[float]:
    text = (text or "").strip()
    if not text:
        return []
    r = client.embeddings.create(model=EMBEDDING_MODEL, input=text)
    return r.data[0].embedding


def _payload_to_source(payload: Dict[str, Any], score: float) -> Dict[str, Any]:
    """
    把你索引時存的 payload 轉成前端能吃的 RagSource
    你們 payload 欄位可能不一樣，所以這裡做容錯。
    """
    title = payload.get("title") or payload.get("file") or payload.get("filename") or payload.get("source") or "unknown"
    page = payload.get("page") or payload.get("pageno") or payload.get("page_no")
    chunk = payload.get("chunk") or payload.get("chunk_id")
    url = payload.get("url")

    # snippet / text
    snippet = payload.get("snippet") or payload.get("text") or payload.get("content")
    if isinstance(snippet, str) and len(snippet) > 900:
        snippet = snippet[:900] + "…"

    return {
        "title": title,
        "file": payload.get("file") or payload.get("filename") or title,
        "page": page,
        "chunk": chunk,
        "url": url,
        "score": float(score) if score is not None else None,
        "snippet": snippet,
        "kind": payload.get("kind") or payload.get("type") or "qdrant",
    }


def retrieve_sources(query: str, top_k: int = TOP_K) -> List[Dict[str, Any]]:
    vec = _embed(query)
    if not vec:
        return []

    try:
        # 兼容不同版本 qdrant-client：有的有 search，有的改成 query_points
        if hasattr(qdrant, "search"):
            hits = qdrant.search(
                collection_name=QDRANT_COLLECTION,
                query_vector=vec,
                limit=top_k,
                with_payload=True,
                with_vectors=False,
            )
        elif hasattr(qdrant, "query_points"):
            # 1.16.x 常見是 query_points；參數名有時叫 query_vector、有時叫 query
            try:
                resp = qdrant.query_points(
                    collection_name=QDRANT_COLLECTION,
                    query_vector=vec,
                    limit=top_k,
                    with_payload=True,
                    with_vectors=False,
                )
            except Exception:  # ✅ 不要只抓 TypeError
                resp = qdrant.query_points(
                    collection_name=QDRANT_COLLECTION,
                    query=vec,
                    limit=top_k,
                    with_payload=True,
                    with_vectors=False,
                )

            hits = getattr(resp, "points", resp)
        else:
            raise RuntimeError("Unsupported qdrant-client: no search/query_points")




    except UnexpectedResponse as e:
        # Qdrant 不通 / collection 不存在
        print(f"❌ Qdrant search failed: {e}")
        return []
    except Exception as e:
        print(f"❌ Qdrant search error: {e}")
        return []

    sources: List[Dict[str, Any]] = []
    for h in hits:
        payload = h.payload or {}
        sources.append(_payload_to_source(payload, getattr(h, "score", None)))

    return sources


def answer_with_rag(user_q: str, session: dict | None = None) -> Tuple[str, List[Dict[str, Any]]]:
    """
    回傳：(answer_text, sources[])
    sources 會被 main.py 包進 actions 給前端顯示。
    """
    user_q = (user_q or "").strip()
    if not user_q:
        return "你問的內容是空的，我沒辦法檢索。請再輸入一次。", []

    sources = retrieve_sources(user_q)

    if not sources:
        # ✅ 老師閉嘴模式：找不到就說找不到
        return (
            "我在目前的教材向量庫裡，找不到足夠匹配的內容。\n"
            "你可以：\n"
            "1) 換更具體關鍵字（例：『肋骨骨折 症狀』/『脛骨骨折 固定方式』）\n"
            "2) 上傳你的 PDF/leaflet 讓我用本次檔案內容回答（不建索引、不污染向量庫）\n",
            []
        )

    context_lines = []
    for i, s in enumerate(sources, 1):
        name = s.get("file") or s.get("title") or f"source-{i}"
        meta = []
        if s.get("page") is not None:
            meta.append(f"p.{s['page']}")
        if s.get("chunk") is not None:
            meta.append(f"chunk:{s['chunk']}")
        if s.get("score") is not None:
            meta.append(f"score:{float(s['score']):.3f}")
        meta_str = " · ".join(meta)
        snippet = s.get("snippet") or ""
        context_lines.append(f"[#{i}] {name} ({meta_str})\n{snippet}")

    context = "\n\n".join(context_lines)

    system = (
        "你是骨科衛教/判讀輔助的助手。你只能根據【提供的檢索片段】回答。\n"
        "如果片段不足以支持結論，必須說『資料不足』，並提出需要的補充資訊。\n"
        "回答要清楚、分點、可直接給老師看。\n"
    )

    prompt = (
        f"【使用者問題】\n{user_q}\n\n"
        f"【檢索片段（可引用）】\n{context}\n\n"
        "請輸出：\n"
        "1) 直接回答\n"
        "2) 判讀/衛教重點（分點）\n"
        "3) 注意事項（你不確定就說不確定）\n"
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
        return ans.strip(), sources
    except Exception as e:
        print(f"❌ LLM answer failed: {e}")
        # 就算 LLM 掛了，也把 sources 回去，至少你 UI 還能證明「有檢索」
        return "檢索有命中，但生成回答時發生錯誤（請看後端 log）。", sources
