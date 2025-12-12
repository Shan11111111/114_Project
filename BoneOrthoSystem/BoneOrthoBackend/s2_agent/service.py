import os
from typing import List, Tuple, Dict, Any, Optional

from shared.vector_client import VectorStore

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
CHAT_MODEL = os.getenv("CHAT_MODEL", "gpt-4.1-mini")

if OPENAI_API_KEY:
    from openai import OpenAI
    _client = OpenAI(api_key=OPENAI_API_KEY)
    print("DEBUG OPENAI_API_KEY:", repr(OPENAI_API_KEY))

else:
    _client = None
    print("⚠️ WARNING: OPENAI_API_KEY 未設定，S2 會使用假資料，不會真的叫 LLM。")

_vs = VectorStore()
_vs.ensure_collection()


def embed_text(text: str) -> List[float]:
    if not _client:
        # 回傳固定長度的假向量（先假設 1536 維）
        return [0.0] * 1536
    resp = _client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=text,
    )
    return resp.data[0].embedding


def rag_search(
    question: str,
    bone_id: Optional[int] = None,
    bone_small_id: Optional[int] = None,
    top_k: int = 5,
) -> Tuple[str, List[Dict[str, Any]]]:
    emb = embed_text(question)
    

    hits = _vs.search(
        embedding=emb,
        top_k=top_k,
        bone_id=bone_id,
        small_bone_id=bone_small_id,
    )

    contexts = []
    sources: List[Dict[str, Any]] = []
    for h in hits:
        p = h.payload or {}
        txt = p.get("text") or ""
        if txt:
            contexts.append(txt)
        sources.append(
            {
                "material_id": p.get("material_id"),
                "title": p.get("title"),
                "type": p.get("type"),
                "language": p.get("language"),
                "file_path": p.get("file_path"),
                "page": p.get("page"),
                "score": float(h.score),
            }
        )

    if not _client:
        # 沒有 LLM，就回一個假答案
        return "（目前未設定 OPENAI_API_KEY，只是示範流程，沒有真正回答）", sources

    # 下面才是正常 LLM 流程
    system_prompt = "你是骨科衛教助理..."
    ctx = "\n\n---\n\n".join(contexts)
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"問題：{question}\n\n以下是教材內容：\n{ctx}"},
    ]
    resp = _client.chat.completions.create(
        model=CHAT_MODEL,
        messages=messages,
    )
    answer = resp.choices[0].message.content.strip()
    return answer, sources
