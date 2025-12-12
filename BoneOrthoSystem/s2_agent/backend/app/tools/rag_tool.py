# app/tools/rag_tool.py
from typing import Tuple, List, Dict, Any
import os
from pathlib import Path
import sys

from openai import OpenAI
from ..models import ChatMessage

# ---------------------------------------------------------
# 把 Bone 根目錄加進 sys.path，才能 import db
# ---------------------------------------------------------
TOOLS_DIR = Path(__file__).resolve().parent      # ...\app\tools
APP_DIR = TOOLS_DIR.parent                       # ...\app
BACKEND_DIR = APP_DIR.parent                     # ...\ai_agent_backend
PROJECT_ROOT = BACKEND_DIR.parent                # ...\Bone

if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

from db import get_connection


# =========================================================
# 保底回答（沒有 API key 或 LLM 掛掉時用）
# =========================================================

def simple_llm_answer(question: str, history: List[ChatMessage]) -> str:
    """
    沒有 OPENAI_API_KEY（或呼叫失敗）時，用這個保底回答，
    至少系統不會 500，只會回示範文字。
    """
    return (
        f"（示範回答）你問的是：「{question}」。目前簡化版 Agent 尚未接上完整的 RAG，"
        "之後會從你上傳或內建的骨科資料中檢索內容來回答。"
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


# =========================================================
# 針對 Bone_Info / Bone_Images 做查詢的小工具
# （只寫在 rag_tool.py，不去改 db.py）
# =========================================================

def _find_bone_from_question(question: str) -> Dict[str, Any] | None:
    """
    從使用者問題裡，嘗試抓出對應的大表 Bone_Info 記錄。

    做法很單純：
    1. 把 Bone_Info 全部撈出來（只有 41 筆，OK）
    2. 如果 bone_zh 有出現在問題裡 → 視為命中
    3. 或 bone_en (不分大小寫) 出現在問題裡 → 視為命中
    4. 命中就順便找 Bone_Images 的一張圖

    回傳 dict：
    {
        "bone_id": ...,
        "bone_en": ...,
        "bone_zh": ...,
        "bone_region": ...,
        "bone_desc": ...,
        "image_url": "/static/upload/xxx.jpg" 或 None
    }
    查不到就回傳 None。
    """
    if not question:
        return None

    with get_connection() as conn:
        cur = conn.cursor()
        # 依你截圖的欄位順序：bone_id, bone_en, bone_zh, bone_region, bone_desc
        cur.execute(
            """
            SELECT bone_id, bone_en, bone_zh, bone_region, bone_desc
            FROM dbo.Bone_Info
            """
        )
        rows = cur.fetchall()

        q_lower = question.lower()

        target_row = None
        for row in rows:
            bone_id = row[0]
            bone_en = str(row[1]) if row[1] is not None else ""
            bone_zh = str(row[2]) if row[2] is not None else ""
            bone_region = str(row[3]) if row[3] is not None else ""
            bone_desc = str(row[4]) if row[4] is not None else ""

            hit = False
            if bone_zh and bone_zh in question:
                hit = True
            elif bone_en and bone_en.lower() in q_lower:
                hit = True

            if hit:
                target_row = {
                    "bone_id": bone_id,
                    "bone_en": bone_en,
                    "bone_zh": bone_zh,
                    "bone_region": bone_region,
                    "bone_desc": bone_desc,
                    "image_url": None,  # 等一下再補圖片路徑
                }
                break

        if not target_row:
            return None

        # 嘗試從 Bone_Images 撈一張圖回來（可選）
        try:
            cur.execute(
                """
                SELECT TOP 1 image_path
                FROM dbo.Bone_Images
                WHERE bone_id = ?
                ORDER BY image_id
                """,
                target_row["bone_id"],
            )
            img_row = cur.fetchone()
            if img_row and img_row[0]:
                # image_path 看起來像 "/static/upload/xxx"
                target_row["image_url"] = str(img_row[0])
        except Exception as e:
            # 圖片表有問題就先印 log，不要讓整個聊天壞掉
            print("[_find_bone_from_question] fetch image error:", e)

        return target_row


def _answer_from_db_only(question: str, bone: Dict[str, Any]) -> str:
    """
    沒有 LLM（沒 key）時，如果有查到 Bone_Info，就用資料庫內容組一個人類可讀的回答。
    """
    bone_zh = bone.get("bone_zh") or ""
    bone_en = bone.get("bone_en") or ""
    bone_region = bone.get("bone_region") or ""
    bone_desc = bone.get("bone_desc") or ""

    parts: List[str] = []
    if bone_zh or bone_en:
        title = f"{bone_zh}（{bone_en}）" if bone_zh and bone_en else (bone_zh or bone_en)
        parts.append(f"你問的是「{title}」相關的問題。")

    if bone_region:
        parts.append(f"這塊骨頭位於：{bone_region}。")

    if bone_desc:
        parts.append("以下是系統中骨科資料庫對這塊骨頭的詳細說明：")
        parts.append(bone_desc)

    if not parts:
        # 萬一欄位都空空的，就回個保底
        return simple_llm_answer(question, [])

    return "\n\n".join(parts)


# =========================================================
# 對外主入口：answer_with_rag
# =========================================================

def answer_with_rag(question: str, session: dict) -> Tuple[str, List[Dict[str, Any]]]:
    """
    對外主入口：

    目前做法：
    1. 先看看問題裡有沒有提到某塊骨頭（用 Bone_Info 比對 bone_zh / bone_en）。
       - 有命中 → 把那筆 Bone_Info + 一張 Bone_Images（如果有）當「知識庫」。
    2. 如果沒有 OPENAI_API_KEY：
       - 有命中骨頭 → 用資料庫內容組一個解釋回答。
       - 沒命中 → 回傳 simple_llm_answer 的示範文字。
    3. 如果有 OPENAI_API_KEY：
       - 把「骨科資料庫內容」＋「對話歷史」＋「最新問題」一起丟進 LLM，
         讓 LLM 用資料庫內容來生成有條理的繁體中文回答。
    4. 回傳：
       - 第一個是文字答案（給 main.py 做成 assistant 的 ChatMessage）。
       - 第二個是 sources（目前先放圖片資訊，main.py 還沒用到，以後如果要在 RAG 回覆裡顯示圖片，可以從這邊接）。
    """
    history: List[ChatMessage] = session.get("messages", [])

    # 先試著看看問題裡有沒有骨頭關鍵字
    bone_info: Dict[str, Any] | None = None
    try:
        bone_info = _find_bone_from_question(question)
    except Exception as e:
        print("[answer_with_rag] _find_bone_from_question error:", e)

    sources: List[Dict[str, Any]] = []
    if bone_info and bone_info.get("image_url"):
        # 先把圖片資訊放到 sources，之後如果你想在 main.py 額外產一則 image 訊息可以用
        sources.append(
            {
                "type": "bone_image",
                "bone_id": bone_info["bone_id"],
                "bone_zh": bone_info["bone_zh"],
                "bone_en": bone_info["bone_en"],
                "image_url": bone_info["image_url"],
            }
        )

    api_key = os.getenv("OPENAI_API_KEY", "").strip()

    # ---------- 沒有 key → 不走 LLM，只靠資料庫 / 示範 ----------
    if not api_key:
        if bone_info:
            ans = _answer_from_db_only(question, bone_info)
            return ans, sources

        ans = simple_llm_answer(question, history)
        return ans, []

    # ---------- 有 key → 呼叫 OpenAI LLM ----------
    try:
        client = OpenAI(api_key=api_key)
    except Exception as e:
        print("[answer_with_rag] init OpenAI client error:", e)
        # 如果建 client 都失敗，就退回「資料庫 / 示範」邏輯
        if bone_info:
            ans = _answer_from_db_only(question, bone_info)
            return ans, sources
        ans = simple_llm_answer(question, history)
        return ans, []

    hist_text = _build_history_text(history)

    db_context = ""
    if bone_info:
        # 把大表資訊串成一段文字，當成 LLM 的知識庫
        title = f"{bone_info['bone_zh']}（{bone_info['bone_en']}）"
        region = bone_info.get("bone_region") or ""
        desc = bone_info.get("bone_desc") or ""
        db_context = f"目標骨頭：{title}\n"
        if region:
            db_context += f"骨頭區域：{region}\n"
        if desc:
            db_context += f"詳細說明：{desc}\n"

    prompt = (
        "你是骨科教學 AI 助理，請用繁體中文回答問題，"
        "回答要有條理，可以條列重點，避免廢話。\n\n"
        # 有命中骨頭時，把資料庫內容放在前面
        + (f"【骨科資料庫】\n{db_context}\n" if db_context else "")
        + f"【對話紀錄】\n{hist_text}\n\n"
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
        if not content:
            # LLM 回空字串，就退回資料庫 / 示範
            if bone_info:
                content = _answer_from_db_only(question, bone_info)
            else:
                content = simple_llm_answer(question, history)
        return content, sources
    except Exception as e:
        print("[answer_with_rag] completion error:", e)
        if bone_info:
            ans = _answer_from_db_only(question, bone_info)
            return ans, sources
        ans = simple_llm_answer(question, history)
        return ans, []
