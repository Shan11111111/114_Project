# s2_agent/evals/faithfulness_eval.py

from __future__ import annotations

import json
import re
from typing import List, Dict, Any

from openai import OpenAI

client = OpenAI()

def _context_body(c: Any) -> str:
    if not isinstance(c, dict):
        return str(c)

    return str(
        c.get("text")
        or c.get("content")
        or c.get("snippet")
        or c.get("abstract")
        or ""
    ).strip()
    
    
    
    
    
JUDGE_PROMPT = """
你是 RAG Faithfulness 評估器。

請根據提供的 contexts，
判斷 answer 中的每個 claim 是否被支持。

你的任務不是判斷 claim 是否符合常識，
而是判斷 claim 是否能由 contexts 直接支持，或由 contexts 合理推出。

輸出語言規則：
1. reason 必須使用繁體中文。
2. claim 請保留原本 answer 的語言，不要翻譯。
3. evidence 必須引用 contexts 原文片段，不要翻譯。
4. evidence_source 的 title、page、source_type 保留原值。
5. support_type 必須使用英文固定值：direct、reasonable_extension、general_safety_advice、unsupported。

規則：
1. 優先看語意是否一致，不要求逐字完全相同。
2. 每個 supported claim 都必須提供 evidence。
3. evidence 必須是 contexts 中可支持該 claim 的原文片段。
4. 如果 unsupported，evidence 請填空字串 ""。
5. 不要過度嚴格；不要因為 claim 的例子沒有逐字出現在 context 中，就直接判 unsupported。

support_type 判斷：

1. direct：
   若 claim 的主要事實可以直接從 context 找到，判 supported=true，support_type="direct"。
   evidence 必須引用 context 原文片段。

2. reasonable_extension：
   若 claim 是由 context 中明確描述的機制、功能、定義所自然推出的常識性例子，
   且沒有加入新的醫療診斷、治療建議、劑量、數值、風險比例、療效比較或特定研究結論，
   則判 supported=true，support_type="reasonable_extension"。
   evidence 必須引用可支持推論的 context 原文片段。

   例如：
   context：「肌肉收縮拉動骨骼以產生動作，韌帶維持關節穩定。」
   claim：「骨骼、關節與肌肉協同運作，使人能走路、跑步或跳躍。」
   這屬於合理延伸，不應視為 unsupported。

3. general_safety_advice：
   若 claim 是一般安全提醒、保守衛教提醒或就醫提醒，
   可以判 supported=true，support_type="general_safety_advice"。
   這類 claim 不需要 contexts 逐字支持，但必須符合以下條件：
   - 內容保守、安全、不誇大。
   - 沒有提供具體診斷。
   - 沒有提供具體治療承諾。
   - 沒有提供藥物、劑量、療效比例或研究結論。
   - 沒有宣稱來自某個 context 或資料庫。

   可歸類為 general_safety_advice 的例子：
   - 若疼痛持續或加劇，建議尋求醫療人員評估。
   - 若出現麻木、無力、劇烈疼痛或活動受限，應就醫。
   - 本回答不能取代醫師診斷。
   - 若症狀影響日常生活，建議尋求專業評估。
   - 及早評估有助於了解問題來源，但不可保證治療效果。

   若 claim 屬於 general_safety_advice：
   - supported 必須為 true。
   - evidence 請填「一般安全衛教提醒」。
   - evidence_source 的 title 填「general_safety_advice」，page 填空字串，source_type 填「safety」。
   - reason 必須說明這是保守安全提醒，不是資料庫直接證據。

4. unsupported：
   若 claim 引入 contexts 沒有提供的新數值、新病因、新治療建議、新劑量、新風險比較、
   新療效結論，或與 contexts 不一致，且也不是 general_safety_advice，
   才判 supported=false，support_type="unsupported"。

重要限制：
- 若 claim 涉及具體疾病因果、診斷依據、治療方式、用藥、營養劑量、疾病風險、治療效果、臨床判斷、研究結論，必須有明確 evidence，不能用 general_safety_advice 放過。
- 若 claim 只是保守提醒「建議就醫、不能取代醫師、症狀嚴重需評估」，可以用 general_safety_advice。
- 若 claim 只是把 context 的機制轉成日常例子，可以用 reasonable_extension。
請輸出 JSON 格式：

{
  "claims": [
    {
      "claim": "...",
      "supported": true,
      "support_type": "direct",
      "reason": "請用繁體中文說明為什麼此 claim 被支持或不被支持。",
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
    
    if "【模型知識補充｜非知識庫證據】" in answer:
        return {
            "faithfulness": None,
            "faithfulness_applicable": False,
            "supported_claims": 0,
            "total_claims": len(claims),
            "unsupported_claims": [],
            "details": [],
            "reason": "此回答包含模型知識補充，非完全根據 RAG contexts，故不適合計算 RAG Faithfulness。",
        }
    
    print("\n========== FAITHFULNESS CONTEXT ==========")

    for i, c in enumerate(contexts):
        print(f"\n--- CONTEXT {i+1} ---")
        print(json.dumps(c, ensure_ascii=False, indent=2))

    print("=========================================\n")

    formatted_claims = "\n".join(
        [f"{idx+1}. {c}" for idx, c in enumerate(claims)]
    )
    
    
    
    
    

    def _context_body(c: Any) -> str:
        if not isinstance(c, dict):
            return str(c)

        return str(
            c.get("text")
            or c.get("content")
            or c.get("snippet")
            or c.get("abstract")
            or ""
        ).strip()


    context_text = "\n\n".join([
    f"""
    [CONTEXT {i+1}]
    title: {c.get("title") or c.get("display_title") or "" if isinstance(c, dict) else ""}
    page: {c.get("page", "") if isinstance(c, dict) else ""}
    source_type: {c.get("source_type", "") if isinstance(c, dict) else ""}

    text:
    {_context_body(c)}
    """
    for i, c in enumerate(contexts)
    ])
        
    
    
    
    
    
    print("\n========== USER PROMPT ==========")
    print(context_text[:5000])
    print("=================================\n")

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
    
    for c in claim_results:
        if "support_type" not in c:
            c["support_type"] = "direct" if c.get("supported") is True else "unsupported"

        if c.get("support_type") == "general_safety_advice":
            c["supported"] = True
            if not c.get("evidence"):
                c["evidence"] = "一般安全衛教提醒"
            if not c.get("evidence_source"):
                c["evidence_source"] = {
                    "title": "general_safety_advice",
                    "page": "",
                    "source_type": "safety",
                }
                
                
    # general_safety_advice 是安全提醒，不納入 RAG faithfulness 分母
    safety_claims = [
        c for c in claim_results
        if c.get("support_type") == "general_safety_advice"
    ]

    scored_claims = [
        c for c in claim_results
        if c.get("support_type") != "general_safety_advice"
    ]

    supported_types = {
        "direct",
        "reasonable_extension",
    }

    supported_claims = sum(
        1 for c in scored_claims
        if c.get("supported") is True
        and c.get("support_type") in supported_types
    )

    total_claims = len(scored_claims)

    faithfulness = (
        supported_claims / total_claims
        if total_claims > 0
        else 1.0
    )

    unsupported_claims = [
        c for c in scored_claims
        if c.get("support_type") == "unsupported"
        or c.get("supported") is not True
    ]

    return {
    "faithfulness": round(faithfulness, 3),
    "supported_claims": supported_claims,
    "total_claims": total_claims,
    "raw_total_claims": len(claim_results),
    "safety_claims": len(safety_claims),
    "unsupported_claims": unsupported_claims,
    "details": claim_results,
}