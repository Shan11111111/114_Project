# BoneOrthoBackend/s2_agent/legacy_agent/backend/app/tools/rag_tool.py
from __future__ import annotations

import os
import sys
import json
import re
from pathlib import Path
from typing import Tuple, List, Dict, Any, Optional

from openai import OpenAI

# ---------------------------------------------------------
# 確保可以 import 專案根目錄的 db.py / shared / s2_agent
# ---------------------------------------------------------
THIS_FILE = Path(__file__).resolve()
PROJECT_ROOT = THIS_FILE.parents[6]  # .../BoneOrthoBackend
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

from shared.vector_client import VectorStore  # noqa: E402
from s2_agent.service import embed_text       # noqa: E402

# 你的 ChatMessage model（用於 history）
from ..models import ChatMessage              # noqa: E402


# =========================================================
# 設定
# =========================================================
TOP_K = int(os.getenv("RAG_TOP_K", "5"))
SCORE_THRESHOLD = float(os.getenv("RAG_SCORE_THRESHOLD", "0.33"))
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")

# 如果你想強制只回答「教材 + DB」不要自己腦補，把溫度壓低
TEMPERATURE = float(os.getenv("RAG_TEMPERATURE", "0.2"))
MAX_TOKENS = int(os.getenv("RAG_MAX_TOKENS", "900"))


# =========================================================
# 亂碼/掃描 PDF 防呆
# =========================================================
_BAD_CHARS = set("�˙ːʊ̊")
_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
)

def is_gibberish(text: str) -> bool:
    if not text:
        return True
    t = text.strip()
    if len(t) < 20:
        return True

    bad = sum(1 for ch in t if ord(ch) < 32 or ch in _BAD_CHARS)
    ratio_bad = bad / max(len(t), 1)

    good = sum(
        1 for ch in t
        if ("\u4e00" <= ch <= "\u9fff") or ch.isalnum() or ch in "，。,.%()/- \n"
    )
    ratio_good = good / max(len(t), 1)

    return ratio_bad > 0.05 or ratio_good < 0.35


def _build_history_text(history: List[ChatMessage]) -> str:
    lines: List[str] = []
    for m in history:
        if m.type != "text" or not m.content:
            continue
        role = "使用者" if m.role == "user" else "AI" if m.role == "assistant" else m.role
        lines.append(f"{role}: {m.content}")
    return "\n".join(lines)


# =========================================================
# 從 Qdrant 取回 chunks（真的做 RAG 的核心）
# =========================================================
def retrieve_hits(question: str) -> List[Dict[str, Any]]:
    qvec = embed_text(question)

    vs = VectorStore()
    # 確保 collection 存在（你之前已寫入了，不會重建資料）
    try:
        vs.ensure_collection()
    except Exception:
        # 讓它就算 ensure_collection 掛了也不要整個聊天死掉
        pass

    # VectorStore.search 會自動相容 search / query_points
    raw = vs.search(embedding=qvec, top_k=TOP_K)

    hits: List[Dict[str, Any]] = []
    for p in raw:
        score = float(getattr(p, "score", 0.0) or 0.0)
        payload = getattr(p, "payload", None) or {}

        text = (payload.get("text") or "").strip()
        if not text:
            continue

        # 過濾：太低分、掃描 PDF 無字、缺檔、亂碼
        if score < SCORE_THRESHOLD:
            continue
        if text.startswith("[SCANNED/NO-TEXT PDF]") or text.startswith("[MISSING FILE]"):
            continue
        if is_gibberish(text):
            continue

        hits.append(
            {
                "score": score,
                "title": payload.get("title"),
                "material_id": payload.get("material_id"),
                "page": payload.get("page"),
                "file_path": payload.get("file_path") or payload.get("source_file"),
                "type": payload.get("type") or payload.get("source_type"),
                "language": payload.get("language"),
                "style": payload.get("style"),
                "bone_id": payload.get("bone_id"),
                "small_bone_id": payload.get("small_bone_id"),
                "text": text,
            }
        )

    # 依分數排序（保險）
    hits.sort(key=lambda x: x["score"], reverse=True)
    return hits


def _format_context(hits: List[Dict[str, Any]], max_chars: int = 4200) -> str:
    """
    把命中的 chunks 組成 context，避免 prompt 爆掉。
    """
    parts: List[str] = []
    used = 0

    for i, h in enumerate(hits, 1):
        title = h.get("title") or "Untitled"
        page = h.get("page")
        score = h.get("score", 0.0)

        header = f"[來源 {i}] {title} / page={page} / score={score:.3f}"
        body = (h.get("text") or "").strip()

        block = header + "\n" + body + "\n"
        if used + len(block) > max_chars:
            break

        parts.append(block)
        used += len(block)

    return "\n".join(parts).strip()


def _fallback_answer_no_hits(question: str) -> Tuple[str, List[Dict[str, Any]]]:
    """
    沒 hits 時：不要硬掰醫療結論，改成引導補資料。
    """
    msg = (
        "我在教材向量庫（Qdrant）沒有撈到足夠的內容可以可靠回答這題。\n"
        "為了避免亂講造成誤導，我先不直接下醫療結論。\n\n"
        "你可以試試：\n"
        "1) 換更精準關鍵字：例如「椎體成形術」「骨水泥」「脊椎壓迫性骨折 治療」\n"
        "2) 確認教材已建立索引（你剛剛 query_test 有 hits 就代表可以）\n"
        "3) 若你希望我一定要回答：請把你們要用的官方衛教 PDF 都灌進向量庫\n\n"
        f"（你剛問：{question}）"
    )
    return msg, []


# =========================================================
# 對外主入口：answer_with_rag
# 回傳：(answer_text, sources)
# =========================================================
def answer_with_rag(question: str, session: dict) -> Tuple[str, List[Dict[str, Any]]]:
    history: List[ChatMessage] = session.get("messages", [])

    # 1) retrieve
    hits = retrieve_hits(question)

    # sources（存進 DB MetaJson 用）
    sources = [
        {
            "title": h.get("title"),
            "material_id": h.get("material_id"),
            "page": h.get("page"),
            "file_path": h.get("file_path"),
            "score": h.get("score"),
        }
        for h in hits[:TOP_K]
    ]

    # 2) no hits -> fallback
    if not hits:
        return _fallback_answer_no_hits(question)

    # 3) build context
    context = _format_context(hits)
    hist_text = _build_history_text(history)

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        # 沒 key 就用「根據 context 摘要」保底
        ans = (
            "我從教材向量庫找到以下內容（節錄重點），整理回答你：\n\n"
            "—\n"
            f"{context[:1200]}\n"
            "—\n\n"
            "（目前未設定 OPENAI_API_KEY，因此先以教材節錄方式回答）"
        )
        return ans, sources

    # 4) LLM answer (grounded)
    client = OpenAI(api_key=api_key)

    prompt = (
        "你是骨科衛教/教學助理，請用「繁體中文」回答。\n"
        "規則：\n"
        "1) 只能依據【教材內容】回答，不足就明確說不足。\n"
        "2) 回答要條列、可讀、不要廢話。\n"
        "3) 需要提到治療方式/注意事項時，請引用教材提到的內容，並在句尾標註來源編號(例如 [來源 1])。\n\n"
        f"【教材內容】\n{context}\n\n"
        f"【對話紀錄】\n{hist_text}\n\n"
        f"【使用者問題】\n{question}\n"
    )

    try:
        resp = client.chat.completions.create(
            model=LLM_MODEL,
            messages=[
                {"role": "system", "content": "你是一位嚴謹、以教材為準的骨科衛教助理。"},
                {"role": "user", "content": prompt},
            ],
            temperature=TEMPERATURE,
            max_tokens=MAX_TOKENS,
        )
        content = (resp.choices[0].message.content or "").strip()

        if not content:
            # 保底：至少把教材節錄給出來
            content = (
                "我有撈到教材內容，但模型回覆空白；先提供教材節錄供你確認：\n\n"
                f"{context[:1500]}"
            )

        return content, sources

    except Exception as e:
        # LLM 掛掉 -> 退回教材節錄
        content = (
            "我有撈到教材內容，但 LLM 生成失敗（可能是 API/網路/額度問題）。\n"
            "先給你教材節錄，避免你空手：\n\n"
            f"{context[:1500]}\n\n"
            f"（錯誤：{type(e).__name__}）"
        )
        return content, sources
