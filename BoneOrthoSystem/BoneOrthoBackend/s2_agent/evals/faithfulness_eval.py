# s2_agent/evals/faithfulness_eval.py

from __future__ import annotations

import json
import re
from typing import List, Dict, Any

from openai import OpenAI

client = OpenAI()


JUDGE_PROMPT = """
你是 RAG Faithfulness 評估器。

請根據提供的 contexts，
判斷 answer 中的每個 claim 是否被支持。

規則：
1. 優先看語意是否一致
2. 不要求逐字完全相同
3. 合理的醫學語意推論可以接受
4. 只有明顯超出 contexts 才算 unsupported
5. 不要過度嚴格
6. 每個 supported claim 都必須提供 evidence
7. evidence 必須是 contexts 中可支持該 claim 的原文片段
8. 如果 unsupported，evidence 請填空字串 ""

請輸出 JSON 格式：

{
  "claims": [
    {
      "claim": "...",
      "supported": true,
      "reason": "...",
      "evidence": "...",
      "evidence_source": {
        "title": "...",
        "page": "...",
        "source_type": "..."
      }
    }
  ]
}
"""


def split_claims(answer: str) -> List[str]:
    claims = re.split(r"[。！？\n]", answer)

    cleaned = []

    for c in claims:
        c = c.strip()

        if not c:
            continue

        # 過短
        if len(c) < 6:
            continue

        # 純標題
        if re.match(r"^\d+\)", c):
            continue

        # 純 bullet title
        if c in [
            "綜合回答",
            "骨骼學習重點",
            "注意事項",
            "延伸學習問題",
        ]:
            continue

        if "小罐頭" in c:
            continue

        # 問句不要算
        if "？" in c or "?" in c:
            continue

        cleaned.append(c)

    return cleaned


def evaluate_faithfulness(
    question: str,
    answer: str,
    contexts: List[Any],
    model: str = "gpt-4.1-mini",
) -> Dict[str, Any]:

    claims = split_claims(answer)

    formatted_claims = "\n".join(
        [f"{idx+1}. {c}" for idx, c in enumerate(claims)]
    )

    context_text = "\n\n".join([
    f"""
[CONTEXT {i+1}]
title: {c.get("title", "") if isinstance(c, dict) else ""}
page: {c.get("page", "") if isinstance(c, dict) else ""}
source_type: {c.get("source_type", "") if isinstance(c, dict) else ""}

text:
{c.get("text", "") if isinstance(c, dict) else str(c)}
"""
    for i, c in enumerate(contexts)
])

    user_prompt = f"""
Question:
{question}

Claims:
{formatted_claims}

Contexts:
{context_text}
"""

    response = client.chat.completions.create(
        model=model,
        temperature=0,
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": JUDGE_PROMPT,
            },
            {
                "role": "user",
                "content": user_prompt,
            },
        ],
    )

    raw = response.choices[0].message.content

    try:
        data = json.loads(raw)
    except Exception:
        return {
            "faithfulness": 0,
            "error": "JSON parse failed",
            "raw": raw,
        }

    claim_results = data.get("claims", [])

    total_claims = len(claim_results)

    supported_claims = sum(
        1 for c in claim_results if c.get("supported") is True
    )

    faithfulness = (
        supported_claims / total_claims
        if total_claims > 0
        else 0
    )

    unsupported_claims = [
        c for c in claim_results if not c.get("supported")
    ]

    return {
        "faithfulness": round(faithfulness, 3),
        "supported_claims": supported_claims,
        "total_claims": total_claims,
        "unsupported_claims": unsupported_claims,
        "details": claim_results,
    }