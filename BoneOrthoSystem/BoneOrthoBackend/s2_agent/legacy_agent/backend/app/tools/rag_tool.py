from __future__ import annotations

from dotenv import load_dotenv
from pathlib import Path

# 指到 BoneOrthoBackend/.env
load_dotenv(Path(__file__).resolve().parents[5] / ".env")

import os
import re
from typing import Tuple, List, Dict, Any

from openai import OpenAI
from qdrant_client import QdrantClient

from ..models import ChatMessage
from s2_agent.service import embed_text  # 你們現成的 embedding


QDRANT_URL = os.getenv("QDRANT_URL", "http://127.0.0.1:6333")
COLLECTION = os.getenv("QDRANT_COLLECTION", "bone_edu_docs")

# ====== 控制行為的硬規則 ======
TOP_K = int(os.getenv("RAG_TOP_K", "4"))
THRESHOLD = float(os.getenv("RAG_THRESHOLD", "0.30"))  # 先用 0.25~0.35 試
MAX_LINES = int(os.getenv("RAG_MAX_LINES", "6"))
NO_DATA_REPLY = "資料庫沒有對應資料，是否要改問其他關鍵字或補充情境？"

SYSTEM_PROMPT = """你是 GalaBone 的醫療衛教助理。你的任務是：只回答使用者當下問題，不要擴寫成百科全書。

你只被允許使用我提供的【檢索內容】作答；禁止使用常識補充、禁止自行推測。

硬性規則（必須遵守）：
1) 僅能使用【檢索內容】中與問題直接相關的資訊；不相關的一律忽略。
2) 若【檢索內容】與問題主題不一致或不足以回答，請直接回覆：
   「資料庫沒有對應資料，是否要改問其他關鍵字或補充情境？」
3) 回答預設精簡模式：最多 6 行（含條列），除非使用者明確說「講詳細」。
4) 回答結構固定（不得新增段落）：
   - 一句話結論
   - 3 個重點（條列）
   - 需要就醫/警訊（最多 2 點）
5) 引用來源：只列你真的有用到的來源編號，例如 [1][2]；不要列沒用到的。
6) 禁止跨主題亂混：使用者沒問的疾病/主題，不要主動提。

安全提醒：你不是醫師，提供衛教資訊；若有急性劇痛、肢體變形、麻木無力、呼吸困難等紅旗症狀，建議立即就醫。
""".strip()


# ====== 小工具 ======
def _cap_lines(s: str, n: int = MAX_LINES) -> str:
    s = (s or "").strip()
    lines = s.splitlines()
    return "\n".join(lines[:n]).strip()


def _extract_used_indices(answer: str, max_idx: int) -> list[int]:
    nums = [int(x) for x in re.findall(r"\[(\d+)\]", answer or "")]
    used, seen = [], set()
    for k in nums:
        if 1 <= k <= max_idx and k not in seen:
            seen.add(k)
            used.append(k)
    return used


def _looks_like_cosine_score(score: float | None) -> bool:
    return score is not None and -1.0 <= score <= 1.0


def _pass_threshold(score: float | None) -> bool:
    # 如果 score 不在 -1~1（或 None），先不硬過濾，避免你們距離尺度不同造成全滅
    if score is None:
        return True
    if _looks_like_cosine_score(score):
        return score >= THRESHOLD
    return True


TOPIC_KEYWORDS = [
    # (問題關鍵字, 允許的教材關鍵字)
    (["聽力", "耳鳴", "耳朵", "聽覺", "聽力檢查"], ["聽力", "耳"]),
    (["骨折", "骨裂", "外傷", "扭傷"], ["骨折", "外傷", "骨裂"]),
    (["骨質疏鬆", "骨鬆"], ["骨質疏鬆", "骨鬆"]),
]


def _topic_filter(question: str, hits: list[dict]) -> list[dict]:
    q = question or ""
    want_tokens = None
    for q_keys, tokens in TOPIC_KEYWORDS:
        if any(k in q for k in q_keys):
            want_tokens = tokens
            break
    if not want_tokens:
        return hits  # 沒命中主題就不過濾

    filtered = []
    for h in hits:
        title = (h.get("title") or "")
        text = (h.get("text") or "")
        hay = title + " " + text
        if any(t in hay for t in want_tokens):
            filtered.append(h)
    return filtered


# ====== 原本 demo / history（保留） ======
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


# ====== Qdrant 檢索 ======
def _qdrant_search(question: str, limit: int = TOP_K) -> List[Dict[str, Any]]:
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
    ctx_parts: List[str] = ["【檢索內容】"]
    sources: List[Dict[str, Any]] = []
    total = 0

    for i, h in enumerate(hits, 1):
        title = (h.get("title") or "").strip()
        material_id = str(h.get("material_id") or "")
        page = h.get("page", None)
        score = h.get("score", None)
        text = (h.get("text") or "").strip()

        sources.append({"idx": i, "title": title, "material_id": material_id, "page": page, "score": score})

        block = f"[{i}] {title} page={page}\n{text}\n"
        total += len(block)
        if total > max_chars:
            break
        ctx_parts.append(block)

    return "\n".join(ctx_parts).strip(), sources


# ====== 主流程：回答 ======
def answer_with_rag(question: str, session: dict) -> Tuple[str, List[Dict[str, Any]]]:
    history: List[ChatMessage] = session.get("messages", [])

    # 1) 查向量庫
    try:
        hits = _qdrant_search(question, limit=TOP_K)
    except Exception as e:
        print("[answer_with_rag] qdrant search error:", e)
        return NO_DATA_REPLY, []

    if not hits:
        return NO_DATA_REPLY, []

    # 2) 主題過濾（避免問聽力卻撈骨科）
    hits = _topic_filter(question, hits)

    # 3) 相似度門檻（避免塞垃圾）
    hits = [h for h in hits if _pass_threshold(h.get("score"))]

    if not hits:
        return NO_DATA_REPLY, []

    context_str, sources = _format_context(hits)

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        # 沒 LLM 時也保持精簡，不噴全文摘錄
        brief = []
        for s in sources[:3]:
            brief.append(f"[{s['idx']}] {s.get('title','')} page={s.get('page')}")
        ans = "我找到可能相關的教材，但目前未設定 LLM，無法生成精簡回答。\n" + "\n".join(brief)
        return _cap_lines(ans, MAX_LINES), sources[:3]

    # 4) messages：固定把檢索內容放在 system 讓它「只能用這段」
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "system", "content": context_str},
        {"role": "user", "content": question},
    ]

    try:
        client = OpenAI(api_key=api_key)
        resp = client.chat.completions.create(
            model=os.getenv("LLM_MODEL", "gpt-4o-mini"),
            messages=messages,
            temperature=0.2,
            max_tokens=350,  # 刻意縮小，避免長篇大論
        )
        content = (resp.choices[0].message.content or "").strip()
        if not content:
            return NO_DATA_REPLY, []

        # 5) 強制最多 6 行
        content = _cap_lines(content, MAX_LINES)

        # 6) sources 只回真的被引用到的 [n]
        used = _extract_used_indices(content, max_idx=len(sources))
        used_sources = [sources[i - 1] for i in used] if used else []

        return content, used_sources

    except Exception as e:
        print("[answer_with_rag] completion error:", e)
        return NO_DATA_REPLY, []
