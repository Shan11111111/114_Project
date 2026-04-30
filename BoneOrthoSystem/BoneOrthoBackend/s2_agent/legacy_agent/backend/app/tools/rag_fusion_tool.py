#s2_agent/legacy_agent/backend/app/tools/rag_fusion_tool.py
# s2_agent/legacy_agent/backend/app/tools/rag_fusion_tool.py
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from .rag_tool import retrieve_sources, _build_history_summary, _build_retrieval_query
from .pubmed_tool import retrieve_pubmed_sources
from .soap_csv_service import retrieve_soap_sources


Evidence = Dict[str, Any]

def clean_soap_text(text: str) -> str:
    if not text:
        return ""

    # 切掉前面 metadata（Record ID / Visit Date）
    text = re.sub(r"\[SOAP.*?\]", "", text)
    text = re.sub(r"Record ID:.*?Visit Date:.*?", "", text)

    # 只保留 Subjective / Objective / Assessment / Plan
    # 或直接簡化成 readable
    text = re.sub(r"\s+", " ", text).strip()

    return text

def route_sources(query: str) -> List[str]:
    q = (query or "").lower()
    sources = set()
    
    

    if any(k in q for k in [
        "骨頭", "骨骼", "位置", "功能", "解剖", "介紹", "衛教",
        "什麼是", "是什麼", "在哪", "構造", "骨質疏鬆", "骨鬆", "骨折"
    ]):
        sources.add("vector")

    if any(k in q for k in [
        "病人", "個案", "主訴", "病史", "檢查", "處置",
        "soap", "s:", "o:", "a:", "p:", "病歷", "就診"
    ]):
        sources.add("soap")

    if any(k in q for k in [
        "研究", "文獻", "pubmed", "paper", "藥物", "副作用",
        "治療指引", "臨床試驗", "guideline", "用藥", "治療"
    ]):
        sources.add("pubmed")
    
    

    # 常見跨來源問題：教材 + 文獻一起看
    if any(k in q for k in ["骨質疏鬆", "骨鬆", "骨折", "治療", "診斷", "風險", "用藥"]):
        sources.update(["vector", "pubmed"])

    if any(k in q for k in ["還有嗎", "還有沒有", "更多", "其他", "處理方法", "怎麼辦"]):
        sources.update(["vector", "pubmed"])
    
    if not sources:
        sources.add("vector")

    return list(sources)


def _text_of(item: Dict[str, Any]) -> str:
    return str(
        item.get("content")
        or item.get("text")
        or item.get("snippet")
        or item.get("abstract")
        or ""
    ).strip()


def normalize_vector_sources(items: List[Dict[str, Any]]) -> List[Evidence]:
    out: List[Evidence] = []
    for item in items or []:
        text = _text_of(item)
        if not text:
            continue

        out.append({
            "source_type": "vector",
            "title": item.get("title") or item.get("display_title") or "教材知識庫",
            "content": text,
            "snippet": item.get("snippet") or text[:300],
            "score": float(item.get("score") or 0.75),
            "url": item.get("url"),
            "download_url": item.get("download_url"),
            "external_url": item.get("external_url"),
            "page": item.get("page"),
            "chunk": item.get("chunk"),
            "material_id": item.get("material_id"),
            "metadata": item,
        })
    return out


def normalize_pubmed_sources(items: List[Dict[str, Any]]) -> List[Evidence]:
    out: List[Evidence] = []
    for item in items or []:
        text = _text_of(item)
        if not text:
            continue

        title = item.get("title") or "PubMed 文獻"
        pmid = item.get("pmid")
        year = item.get("year")
        journal = item.get("journal")

        out.append({
            "source_type": "pubmed",
            "title": title,
            "content": text,
            "snippet": text[:300],
            "score": float(item.get("score") or 0.85),
            "url": item.get("url"),
            "download_url": item.get("url"),
            "pmid": pmid,
            "journal": journal,
            "year": year,
            "page": None,
            "chunk": None,
            "metadata": item,
        })
    return out


def normalize_soap_sources(items: List[Dict[str, Any]]) -> List[Evidence]:
    out: List[Evidence] = []
    for item in items or []:
        raw_text = _text_of(item)
        text = clean_soap_text(raw_text)
        if not text:
            continue
        
        
        out.append({
            "source_type": "soap",
            "title": "輔大醫院授權之去識別化醫囑紀錄表",
            "content": text,
            "snippet": text[:300],
            "score": float(item.get("score") or 0.8),
            "url": None,
            "download_url": None,
            "visit_date": item.get("visit_date"),
            "page": None,
            "chunk": None,
            "metadata": item,
        })
    return out


def dedupe_evidence(items: List[Evidence]) -> List[Evidence]:
    seen = set()
    out: List[Evidence] = []

    for item in items:
        title = str(item.get("title") or "").strip().lower()
        content = str(item.get("content") or "").strip()
        content_key = re.sub(r"\s+", "", content[:160]).lower()
        key = f"{item.get('source_type')}|{title}|{content_key}"

        if not content_key:
            continue
        if key in seen:
            continue

        seen.add(key)
        out.append(item)

    return out


def rerank_evidence(items: List[Evidence]) -> List[Evidence]:
    source_weight = {
        "vector": 1.00,
        "soap": 0.95,
        "pubmed": 1.05,
    }

    for item in items:
        source_type = str(item.get("source_type") or "vector")
        score = float(item.get("score") or 0)
        item["final_score"] = score * source_weight.get(source_type, 1.0)

    return sorted(items, key=lambda x: x.get("final_score", 0), reverse=True)


def limit_by_source(items: List[Evidence], per_source: int = 2, total: int = 6) -> List[Evidence]:
    counts: Dict[str, int] = {}
    out: List[Evidence] = []

    for item in items:
        source_type = str(item.get("source_type") or "unknown")
        counts[source_type] = counts.get(source_type, 0)

        if counts[source_type] >= per_source:
            continue

        out.append(item)
        counts[source_type] += 1

        if len(out) >= total:
            break

    return out


def format_evidence_for_prompt(items: List[Evidence]) -> str:
    blocks = []

    for i, item in enumerate(items, start=1):
        source_type = item.get("source_type", "unknown")
        title = item.get("title", "未命名來源")
        
        source_label = {
    "vector": "GalaBone 衛教資料庫",
    "pubmed": "PubMed 文獻",
    "soap": "輔大醫院授權之去識別化醫囑紀錄表",
}.get(str(source_type).lower(), "GalaBone 參考資料")
        content = item.get("content", "")

        blocks.append(
    f"[Evidence {i}]\n"
    f"來源類型：{source_type}\n"
    f"來源名稱：{source_label}\n"
    f"標題：{title}\n"
    f"內容：{content}"
)

    return "\n\n".join(blocks)


def prepare_auto_fusion_answer(
    user_q: str,
    session: dict | None = None,
    dialog_state: Optional[Dict[str, Any]] = None,
    pubmed_max_results: int = 3,
    soap_max_results: int = 2,
    vector_top_k: int = 3,
) -> Tuple[str, str, List[Dict[str, Any]]]:
    user_q = (user_q or "").strip()
    if not user_q:
        raise ValueError("empty question")
    
    state = dialog_state or {}
    retrieval_query = _build_retrieval_query(user_q, session, state)

    selected_sources = route_sources(retrieval_query)
    evidence: List[Evidence] = []
    

    if "vector" in selected_sources:
        try:
            vector_raw = retrieve_sources(retrieval_query, top_k=vector_top_k)

            if not vector_raw and retrieval_query != user_q:
                vector_raw = retrieve_sources(user_q, top_k=vector_top_k)
                
            evidence.extend(normalize_vector_sources(vector_raw))
        except Exception as e:
            print("auto_fusion vector failed:", e)

    if "pubmed" in selected_sources:
        try:
            pubmed_raw = retrieve_pubmed_sources(retrieval_query, max_results=pubmed_max_results)

            if not pubmed_raw and retrieval_query != user_q:
                pubmed_raw = retrieve_pubmed_sources(user_q, max_results=pubmed_max_results)
            evidence.extend(normalize_pubmed_sources(pubmed_raw))
        except Exception as e:
            print("auto_fusion pubmed failed:", e)

    if "soap" in selected_sources:
        try:
            soap_raw = retrieve_soap_sources(retrieval_query, max_results=soap_max_results)

            if not soap_raw and retrieval_query != user_q:
                soap_raw = retrieve_soap_sources(user_q, max_results=soap_max_results)
                
            evidence.extend(normalize_soap_sources(soap_raw))
        except Exception as e:
            print("auto_fusion soap failed:", e)

    evidence = dedupe_evidence(evidence)
    evidence = rerank_evidence(evidence)
    evidence = limit_by_source(evidence, per_source=2, total=6)

    if not evidence:
        
        
        fallback_query = retrieval_query if retrieval_query != user_q else user_q

        system = (
            "你是骨科衛教/判讀輔助助手。"
            "目前檢索資料不足時，可以提供一般性衛教方向，"
            "但必須明確說明這不是根據本次檢索資料得出的結論，且不可捏造文獻或個案資料。"
        )

        prompt = (
            f"【使用者原始問題】\n{user_q}\n\n"
            f"【系統推定查詢語意】\n{fallback_query}\n\n"
            "目前沒有檢索到足夠資料。\n"
            "請用保守方式回答：\n"
            "1) 先說明資料不足\n"
            "2) 提供一般性骨科衛教方向\n"
            "3) 提醒需要專業醫師判斷\n"
            "4) 建議使用者補充更明確的部位、診斷、影像結果或上傳文件\n"
            
        )

        return system, prompt, []
        

    history_summary = _build_history_summary(user_q, session, state)
    context = format_evidence_for_prompt(evidence)

    system = (
        "你是骨科衛教/判讀輔助助手。\n"
        "你會收到多來源 RAG 檢索資料，來源可能包含 vector、soap、pubmed。\n"
        "請優先根據檢索資料回答，不要捏造資料中沒有的內容。\n"
        "回答前必須先判斷使用者真正想問的是：診斷判斷、治療方式、知識解釋、風險/預後，或資料解讀。\n"
        "禁止只提供泛用醫療常識，必須根據使用者問題語意與檢索內容進行針對性回答。\n"
        "若使用者問『他有病是不是』『是不是有問題』『正常嗎』這類診斷判斷問題，請先說明目前資料能不能支持判斷；不能確定時，要說明缺少哪些資訊，不可直接下診斷。\n"
        "SOAP 只能作為去識別化個案紀錄參考，不可直接當成通用醫療結論。\n"
        "PubMed 可作為研究文獻依據，但要用一般使用者能理解的方式說明。\n"
        "若不同來源觀點不同，請說明差異。\n"
        
        "你不只是回答問題，也要協助使用者學習與理解，請適度引導延伸思考。\n"
        "若回答中出現骨科、影像、藥物或檢查相關概念，必須在該中文名詞第一次出現時直接補上英文專有名詞，不可省略。\n"
        "當問題涉及臨床決策、治療影響或風險評估時，必須進一步說明『因此臨床上會如何調整處置或治療策略』，不可只停留在知識描述。\n"
        "若問題為『如何評估』『如何影響』『怎麼決定』，請優先提供臨床判斷流程或決策邏輯。\n"
        "來源名稱只能使用：（來源：GalaBone 衛教資料庫）、（來源：PubMed 文獻）、（來源：輔大醫院授權之去識別化醫囑紀錄表）。\n"
"請依據實際使用的檢索資料標註來源，不可隨意標註，也不可全部標成同一來源。\n"
    )

    prompt = (
        f"【對話狀態摘要】\n{history_summary or '（無）'}\n\n"
        f"【使用者問題】\n{user_q}\n\n"
        f"【多來源檢索資料】\n{context}\n\n"
        "回答時，請根據不同來源內容分別引用，例如：\n"
"- 若內容來自第一筆資料，標註（E1）\n"
"- 若來自第二筆資料，標註（E2）\n"
"不可全部只標註同一來源。\n"
"請輸出：\n"
"1) 綜合回答（需直接回應問題核心，不可只提供通用知識）\n"
"2) 判讀/衛教重點（如使用者未要求列點，可簡短帶過）\n"
"3) 注意事項（不確定就明確說不確定；若不需要可簡短帶過）\n"
"4) 延伸學習問題：請設計 2～3 個與本主題相關的進階問題，幫助使用者深入理解，問題需具體且具學習價值。\n"
    )

    # 回傳給前端的 sources 要保留 content/snippet，讓 _build_resources 可以顯示
    raw_resources: List[Dict[str, Any]] = []
    for item in evidence:
        raw_resources.append({
            "title": item.get("title"),
            "display_title": item.get("title"),
            "source_type": item.get("source_type"),
            "score": item.get("final_score") or item.get("score"),
            "url": item.get("url"),
            "download_url": item.get("download_url"),
            "external_url": item.get("external_url"),
            "page": item.get("page"),
            "chunk": item.get("chunk"),
            "material_id": item.get("material_id"),
            "snippet": item.get("snippet") or str(item.get("content") or "")[:300],
            "content": item.get("content"),
            "pmid": item.get("pmid"),
            "journal": item.get("journal"),
            "year": item.get("year"),
            "visit_date": item.get("visit_date"),
        })

    return system, prompt, raw_resources