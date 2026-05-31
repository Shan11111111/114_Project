#s2_agent/legacy_agent/backend/app/tools/soap_csv_service.py
from __future__ import annotations

import os
import re
import csv
import html
from pathlib import Path
from typing import Any, Dict, List, Tuple

from dotenv import load_dotenv

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
CHAT_MODEL = os.getenv("CHAT_MODEL", "gpt-4.1-mini")

if OPENAI_API_KEY:
    from openai import OpenAI
    _client = OpenAI(api_key=OPENAI_API_KEY)
else:
    _client = None


SOAP_CSV_PATH = Path(os.getenv("SOAP_CSV_PATH", "s2_agent/data/soap_records.csv"))

SOAP_SUBJECTIVE_COL = os.getenv("SOAP_SUBJECTIVE_COL", "SUBJCONTENT")
SOAP_OBJECTIVE_COL = os.getenv("SOAP_OBJECTIVE_COL", "OBJECONTENT")
SOAP_ASSESSMENT_COL = os.getenv("SOAP_ASSESSMENT_COL", "ASSECONTENT")
SOAP_PLAN_COL = os.getenv("SOAP_PLAN_COL", "PLANCONTENT")
SOAP_DATE_COL = os.getenv("SOAP_DATE_COL", "就診日期")
SOAP_ID_COL = os.getenv("SOAP_ID_COL", "RRN")

def retrieve_soap_sources(question: str, max_results: int = 5) -> list[dict]:
    soap_query = _rewrite_to_soap_query(question)
    rows = _search_soap_rows(soap_query, top_k=max_results)

    out = []
    for i, row in enumerate(rows, start=1):
        content = _build_soap_context([row])
        out.append({
            "source_type": "soap",
            "title": f"SOAP Record {i}",
            "content": content,
            "score": 0.8,
            "url": None,
            "visit_date": row.get(SOAP_DATE_COL),
        })

    return out

def _clean_text(text: str) -> str:
    t = html.unescape(text or "")
    t = re.sub(r"\s+", " ", t).strip()
    return t

def _normalize_row(row: Dict[str, Any]) -> Dict[str, str]:
    normalized = {str(k): _clean_text(str(v or "")) for k, v in row.items()}

    # 去識別化：隱藏個資，但保留骨科診斷、症狀、用藥與處置內容
    normalized[SOAP_ID_COL] = "[REDACTED]"

    for col in [SOAP_SUBJECTIVE_COL, SOAP_OBJECTIVE_COL, SOAP_ASSESSMENT_COL, SOAP_PLAN_COL]:
        if col in normalized:
            content = normalized[col]

            # 移除可能的病歷號 / ID 格式
            content = re.sub(r"[A-Z]{3}\d+", "[ID]", content)
            content = re.sub(r"\b[A-Z][0-9]{9}\b", "[ID]", content)

            # 移除台灣手機號碼
            content = re.sub(r"09\d{8}", "[PHONE]", content)

            # 移除可能的 email
            content = re.sub(
                r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}",
                "[EMAIL]",
                content,
            )

            # 不要把骨折、骨質疏鬆、骨鬆症等診斷名稱改成「異常」
            # 這些是教學與檢索關鍵字，保留才有學習價值

            normalized[col] = content

    return normalized

def _load_soap_rows() -> List[Dict[str, str]]:
    if not SOAP_CSV_PATH.exists():
        raise FileNotFoundError(f"SOAP CSV 不存在：{SOAP_CSV_PATH}")

    rows: List[Dict[str, str]] = []
    with open(SOAP_CSV_PATH, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(_normalize_row(row))
    return rows


def _rewrite_to_soap_query(user_question: str) -> str:
    q = (user_question or "").strip()
    if not q or not _client:
        return q

    try:
        resp = _client.chat.completions.create(
            model=CHAT_MODEL,
            temperature=0.0,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a clinical SOAP retrieval query assistant for an orthopedic learning system. "
                        "Convert the user's question into a concise keyword query for searching de-identified SOAP notes in CSV data. "
                        "Focus on orthopedic and bone-related terms, symptoms, anatomical region, imaging findings, diagnosis, treatment, medication, follow-up, and rehabilitation. "
                        "Preserve important medical entities such as osteoporosis, fracture, spine, lumbar, cervical, knee, hip, radius, ulna, femur, tibia, pain, X-ray, DXA, surgery, medication, assessment, and plan. "
                        "If the user asks about a patient/case/SOAP record, include terms likely to appear in Subjective, Objective, Assessment, and Plan. "
                        "Output 3 to 12 concise Traditional Chinese and English keywords separated by spaces. "
"Include both Chinese medical terms and common English equivalents when useful. "
"For example: 骨質疏鬆 osteoporosis 骨折 fracture 腰椎 lumbar 疼痛 pain 用藥 medication 復健 rehabilitation. "
"Do not output explanation, punctuation-heavy text, or full sentences."
                    ),
                },
                {"role": "user", "content": q},
            ],
        )
        out = (resp.choices[0].message.content or "").strip()
        return out or q
    except Exception:
        return q


def _score_soap_row(row: Dict[str, str], query: str) -> int:
    q_words = [w.lower() for w in re.split(r"\W+", query) if w.strip()]
    if not q_words:
        return 0

    subj = row.get(SOAP_SUBJECTIVE_COL, "")
    obj = row.get(SOAP_OBJECTIVE_COL, "")
    assess = row.get(SOAP_ASSESSMENT_COL, "")
    plan = row.get(SOAP_PLAN_COL, "")

    haystack = " ".join([subj, obj, assess, plan]).lower()

    score = 0
    for w in q_words:
        if w in haystack:
            score += 1

    assess_l = assess.lower()
    plan_l = plan.lower()

    for w in q_words:
        if w in assess_l:
            score += 2
        if w in plan_l:
            score += 3

    return score


def _search_soap_rows(query: str, top_k: int = 5) -> List[Dict[str, str]]:
    rows = _load_soap_rows()

    ranked: List[Tuple[int, Dict[str, str]]] = []
    for row in rows:
        s = _score_soap_row(row, query)
        if s > 0:
            ranked.append((s, row))

    ranked.sort(key=lambda x: x[0], reverse=True)
    return [row for _, row in ranked[: max(1, min(int(top_k or 5), 10))]]


def _build_soap_context(rows: List[Dict[str, str]]) -> str:
    blocks = []
    for i, row in enumerate(rows, start=1):
        blocks.append(
            "\n".join(
                [
                    f"[SOAP {i}] （已去識別化）",
                    f"Record ID: [REDACTED]",  # ← 固定隱藏
                    f"Visit Date: {row.get(SOAP_DATE_COL, '[DATE]')[:10] if row.get(SOAP_DATE_COL) else '[DATE]'}",  # 只留年月日
                    f"Subjective: {row.get(SOAP_SUBJECTIVE_COL, '')}",
                    f"Objective: {row.get(SOAP_OBJECTIVE_COL, '')}",
                    f"Assessment: {row.get(SOAP_ASSESSMENT_COL, '')}",
                    f"Plan (藥物保留): {row.get(SOAP_PLAN_COL, '')}",
                ]
            )
        )
    return "\n\n".join(blocks)



def answer_with_soap_csv(
    question: str,
    max_results: int = 5,
) -> Tuple[str, List[Dict[str, Any]]]:
    q = (question or "").strip()
    if not q:
        return "請先輸入問題。", []

    soap_query = _rewrite_to_soap_query(q)
    rows = _search_soap_rows(soap_query, top_k=max_results)

    sources = [
        {
            "title": f"SOAP Record {i + 1}",
            "page": None,
            "chunk": None,
            "score": None,
            "record_id": row.get(SOAP_ID_COL),
            "visit_date": row.get(SOAP_DATE_COL),
            "source_type": "soap_csv",
        }
        for i, row in enumerate(rows)
    ]

    if not rows:
        return (
            "我有切到 SOAP 模式，但這次沒有查到合適的 SOAP 記錄。"
            "建議把問題改成更明確的英文關鍵字，例如症狀、治療、檢查、診斷名稱。",
            sources,
        )

    if not _client:
        lines = [
            "（目前未設定 OPENAI_API_KEY，以下直接列出 SOAP 檢索結果）",
            "",
        ]
        for i, row in enumerate(rows, start=1):
            lines.append(f"{i}. Record ID: {row.get(SOAP_ID_COL, '')}")
            if row.get(SOAP_DATE_COL):
                lines.append(f"   Date: {row.get(SOAP_DATE_COL)}")
            if row.get(SOAP_SUBJECTIVE_COL):
                lines.append(f"   S: {row.get(SOAP_SUBJECTIVE_COL)[:300]}")
            if row.get(SOAP_OBJECTIVE_COL):
                lines.append(f"   O: {row.get(SOAP_OBJECTIVE_COL)[:300]}")
            if row.get(SOAP_ASSESSMENT_COL):
                lines.append(f"   A: {row.get(SOAP_ASSESSMENT_COL)[:300]}")
            if row.get(SOAP_PLAN_COL):
                lines.append(f"   P: {row.get(SOAP_PLAN_COL)[:300]}")
            lines.append("")
        return "\n".join(lines).strip(), sources

    context = _build_soap_context(rows)

    system_prompt = (
    "你是 GalaBone 的去識別化 SOAP 個案學習助教。"
    "你只能根據提供的 SOAP CSV 內容回答，不可捏造未出現的病史、檢查、診斷、藥物或治療。"
    "請把 SOAP 視為個案學習資料，而不是完整診斷依據。"
    "分析時請依照 S/O/A/P 分工："
    "Subjective 代表主觀症狀與主訴；"
    "Objective 代表檢查、影像或客觀發現；"
    "Assessment 代表醫師評估或診斷方向；"
    "Plan 代表治療、用藥、追蹤或處置。"
    "如果內容與骨骼、關節、影像、藥物或復健相關，請用學生能理解的方式說明其學習意義。"
    "如果證據有限或 SOAP 缺少關鍵欄位，必須明確說明不足之處。"
    "請用繁體中文回答，結構固定為："
    "1) 個案摘要；"
    "2) SOAP 重點整理；"
    "3) 骨骼/骨科學習重點；"
    "4) 注意事項。"
    "不可把 SOAP 個案直接當成通用醫療結論，也不可取代醫師判斷。"
)

    user_prompt = (
    f"使用者問題：\n{q}\n\n"
    f"SOAP 檢索查詢式：\n{soap_query}\n\n"
    f"以下是去識別化 SOAP CSV 檢索結果：\n{context}\n\n"
    "請根據以上 SOAP 內容回答。"
    "若使用者是在問治療或用藥，請優先整理 Assessment 與 Plan；"
    "若使用者是在問症狀或病程，請優先整理 Subjective；"
    "若使用者是在問影像或檢查，請優先整理 Objective。"
    "若有多筆 SOAP，請比較各案例 Assessment 與 Plan 的差異，不要只是逐筆複述。\n"
    "最後請補充這筆個案對骨骼學習的意義。"
)

    resp = _client.chat.completions.create(
        model=CHAT_MODEL,
        temperature=0.2,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    answer = (resp.choices[0].message.content or "").strip()
    return answer, sources