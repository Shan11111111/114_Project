from __future__ import annotations

from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).resolve().parents[5] / ".env")  # 指到 BoneOrthoBackend/.env

import os
from typing import Tuple, List, Dict, Any

from openai import OpenAI
from qdrant_client import QdrantClient

from ..models import ChatMessage
from s2_agent.service import embed_text  # 你們現成的 embedding


QDRANT_URL = os.getenv("QDRANT_URL", "http://127.0.0.1:6333")
COLLECTION = os.getenv("QDRANT_COLLECTION", "bone_edu_docs")


def simple_llm_answer(question: str, history: List[ChatMessage]) -> str:
    return (
        f"（示範回答）你問的是：「{question}」。目前系統暫時無法完成檢索/生成，"
        "請確認 Qdrant 是否啟動、collection 是否存在、且有寫入資料。"
    )


def _build_history_text(history: List[ChatMessage]) -> str:
    lines: List[str] = []
    for m in history:
        if m.type != "text" or not m.content:
            continue
        role = "使用者" if m.role == "user" else ("AI" if m.role == "assistant" else m.role)
        lines.append(f"{role}: {m.content}")
    return "\n".join(lines)


def _qdrant_search(question: str, limit: int = 6) -> List[Dict[str, Any]]:
    client = QdrantClient(url=QDRANT_URL)
    qvec = embed_text(question)

    res = client.query_points(
        collection_name=COLLECTION,
        query=qvec,
        limit=limit,
        with_payload=True,
    )

    hits: List[Dict[str, Any]] = []
    for p in (res.points or []):
        payload = p.payload or {}
        hits.append(
            {
                "score": getattr(p, "score", None),
                "title": payload.get("title"),
                "material_id": payload.get("material_id"),
                "page": payload.get("page"),
                "text": payload.get("text", ""),
            }
        )
    return hits


def _format_context(hits: List[Dict[str, Any]], max_chars: int = 4500) -> Tuple[str, List[Dict[str, Any]]]:
    ctx_parts: List[str] = []
    sources: List[Dict[str, Any]] = []
    total = 0

    for i, h in enumerate(hits, 1):
        title = (h.get("title") or "").strip()
        material_id = str(h.get("material_id") or "")
        page = h.get("page", None)
        score = h.get("score", None)
        text = (h.get("text") or "").strip()

        sources.append({"idx": i, "title": title, "material_id": material_id, "page": page, "score": score})

        block = f"[{i}] title={title} page={page}\n{text}\n"
        total += len(block)
        if total > max_chars:
            break
        ctx_parts.append(block)

    return "\n".join(ctx_parts).strip(), sources


def answer_with_rag(question: str, session: dict) -> Tuple[str, List[Dict[str, Any]]]:
    history: List[ChatMessage] = session.get("messages", [])

    # 1) 查向量庫
    try:
        hits = _qdrant_search(question, limit=6)
    except Exception as e:
        print("[answer_with_rag] qdrant search error:", e)
        return simple_llm_answer(question, history), []

    if not hits:
        return (
            "我在教材向量庫裡找不到相關內容。"
            "你可以換更精準的關鍵字（例如：椎體成形術、骨水泥、脊椎壓迫性骨折、骨質疏鬆），"
            "或上傳更多教材讓我建立索引。",
            [],
        )

    context_str, sources = _format_context(hits)

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        ans = "我找到以下教材內容與你的問題相關：\n\n" + context_str
        ans += "\n\n（尚未設定 OPENAI_API_KEY，所以先以教材摘錄回覆。）"
        return ans, sources

    hist_text = _build_history_text(history)

    prompt = f"""
你是骨科衛教 RAG 助理。你只能根據【教材摘錄】回答，不准自行腦補。
回答規則：
1) 必須用繁體中文，條列清楚（保守治療/介入或手術/注意事項/何時就醫）
2) 教材只要提到特定治療（例如：骨水泥椎體成形術、滲漏風險），就一定要寫出來
3) 每個重點後面要標註來源編號，例如：...（來源 [1]）
4) 最後加「參考來源」列出 [1][2]... 的 title 與 page

【對話紀錄】
{hist_text}

【使用者問題】
{question}

【教材摘錄】
{context_str}
""".strip()

    try:
        client = OpenAI(api_key=api_key)
        resp = client.chat.completions.create(
            model=os.getenv("LLM_MODEL", "gpt-4o-mini"),
            messages=[
                {"role": "system", "content": "你是一位嚴謹、只引用教材的骨科衛教助理。"},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
            max_tokens=900,
        )
        content = (resp.choices[0].message.content or "").strip()
        if not content:
            content = simple_llm_answer(question, history)
        return content, sources

    except Exception as e:
        print("[answer_with_rag] completion error:", e)
        return simple_llm_answer(question, history), sources
