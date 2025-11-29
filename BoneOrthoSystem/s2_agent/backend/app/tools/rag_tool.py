# app/tools/rag_tool.py
from typing import Tuple, List, Dict, Any
import os

from openai import OpenAI
from ..models import ChatMessage
from ..db import get_connection



def simple_llm_answer(question: str, history: List[ChatMessage]) -> str:
    """
    沒有 OPENAI_API_KEY（或呼叫失敗）時，用這個保底回答，
    至少系統不會 500，只會回示範文字。
    """
    return (
        f"（示範回答）你問的是：「{question}」。目前簡化版 Agent 尚未接上 RAG，"
        "之後會從你上傳的骨科資料中檢索內容來回答。"
    )


def _build_history_text(history: List[ChatMessage]) -> str:
    """
    把歷史文字訊息整理成一段文字，當成 prompt 的一部分。
    """
    lines: List[str] = []
    for m in history:
        if m.type != "text" or not m.content:
            continue

        if m.role == "user":
            role = "使用者"
        elif m.role == "assistant":
            role = "AI"
        else:
            role = m.role

        lines.append(f"{role}: {m.content}")
    return "\n".join(lines)


def answer_with_rag(question: str, session: dict) -> Tuple[str, List[Dict[str, Any]]]:
    """
    對外主入口：

    - 如果有設定 OPENAI_API_KEY：
        使用 OpenAI LLM 直接回答（目前先不做向量檢索/RAG，只是 LLM 回答）。
    - 如果沒設定 / 有錯：
        用 simple_llm_answer 當作保底，不讓整個 API 壞掉。
    """
    history: List[ChatMessage] = session.get("messages", [])
    api_key = os.getenv("OPENAI_API_KEY", "").strip()

    # 沒有 key → 直接降級
    if not api_key:
        ans = simple_llm_answer(question, history)
        return ans, []

    # 有 key → 嘗試建立 client
    try:
        client = OpenAI(api_key=api_key)
    except Exception as e:
        print("[answer_with_rag] init OpenAI client error:", e)
        ans = simple_llm_answer(question, history)
        return ans, []

    hist_text = _build_history_text(history)

    prompt = (
        "你是骨科教學 AI 助理，請用繁體中文回答問題，"
        "回答要有條理，可以條列重點，避免廢話。\n\n"
        f"【對話紀錄】\n{hist_text}\n\n"
        f"【使用者最新問題】\n{question}"
    )

    try:
        resp = client.chat.completions.create(
            model=os.getenv("LLM_MODEL", "gpt-4o-mini"),
            messages=[
                {
                    "role": "system",
                    "content": "你是一位嚴謹但溫柔的骨科教學助理。",
                },
                {
                    "role": "user",
                    "content": prompt,
                },
            ],
            temperature=0.2,
            max_tokens=800,
        )
        content = (resp.choices[0].message.content or "").strip()
        return content, []
    except Exception as e:
        print("[answer_with_rag] completion error:", e)
        ans = simple_llm_answer(question, history)
        return ans, []
