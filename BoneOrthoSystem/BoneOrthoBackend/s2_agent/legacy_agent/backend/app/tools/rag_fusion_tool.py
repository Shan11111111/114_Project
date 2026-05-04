#s2_agent/legacy_agent/backend/app/tools/rag_fusion_tool.py
# s2_agent/legacy_agent/backend/app/tools/rag_fusion_tool.py
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from .rag_tool import retrieve_sources, _build_history_summary, _build_retrieval_query
from .pubmed_tool import retrieve_pubmed_sources
from .soap_csv_service import retrieve_soap_sources
from .web_tool import retrieve_web_sources

from .intent_router import analyze_user_intent

from .asset_3d_tool import (
    retrieve_3d_asset,
    retrieve_3d_assets,
    build_render_plan,
    build_multi_render_plan,
    render_plan_source,
)

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

    # 使用者明確要「其他網站 / 外部網站」
    # 你的規則：其他網站 = PubMed + web
    # 不要加 vector / soap，避免跑出教材或 SOAP
    external_site_intent = any(k in q for k in [
        "其他網站", "查其他網站", "再查其他網站",
        "外部網站", "外部資料", "網站資料",
        "查網站", "網路資料", "可信網站",
        "官方網站", "醫院網站",
        "mayo", "cleveland", "aaos", "orthoinfo",
        "medlineplus", "衛福部", "國健署",
    ])

    if external_site_intent:
        return ["pubmed", "web"]

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

    if any(k in q for k in [
        "網站", "網路", "官方", "可信",
        "衛福部", "國健署", "醫院網站",
        "mayo", "cleveland", "aaos", "orthoinfo",
        "medlineplus", "nih", "ncbi",
        "clinical guideline",
    ]):
        sources.add("web")

    # 常見跨來源問題：教材 + 文獻一起看
    if any(k in q for k in ["骨質疏鬆", "骨鬆", "骨折", "治療", "診斷", "風險", "用藥"]):
        sources.update(["vector", "pubmed"])

    # 一般追問：走教材 + PubMed
    # 注意：不要把「其他」放這裡，因為「其他網站」上面已經處理了
    if any(k in q for k in ["還有嗎", "還有沒有", "更多", "處理方法", "怎麼辦"]):
        sources.update(["vector", "pubmed"])

    # 只有「其他治療 / 其他方法」這類才走 vector + pubmed
    if "其他" in q and not any(k in q for k in ["其他網站", "外部網站", "網站"]):
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

def normalize_web_sources(items: List[Dict[str, Any]]) -> List[Evidence]:
    out: List[Evidence] = []

    for item in items or []:
        text = _text_of(item)
        if not text:
            continue

        site_name = item.get("site_name") or "可信醫療網站"
        title = item.get("title") or site_name

        out.append({
            "source_type": "web",
            "title": title,
            "content": text,
            "snippet": item.get("snippet") or text[:300],
            "score": float(item.get("score") or 0.65),
            "url": item.get("url"),
            "download_url": item.get("download_url") or item.get("url"),
            "external_url": item.get("external_url") or item.get("url"),
            "site_name": site_name,
            "is_search_entry": item.get("is_search_entry", True),
            "fetched": item.get("fetched", False),
            "search_topic": item.get("search_topic"),
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
    "web": 0.90,
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
    "web": "可信醫療網站資料",
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


def is_external_site_followup(user_q: str) -> bool:
    q = (user_q or "").lower()
    return any(k in q for k in [
        "其他網站", "查其他網站", "再查其他網站",
        "外部網站", "外部資料", "網站資料",
        "查網站", "網路資料", "可信網站",
        "官方網站", "醫院網站",
    ])
    
def _clean_external_followup_topic(text: str) -> str:
    x = str(text or "").strip()
    if not x:
        return ""

    bad_patterns = [
        r"再查其他網站有沒有資料",
        r"再查其他的網站",
        r"可以再查其他網站嗎",
        r"查其他網站",
        r"其他網站",
        r"外部網站",
        r"網站資料",
        r"網路資料",
        r"有沒有資料",
        r"還有資料嗎",
        r"可以再查",
        r"幫我查",
        r"查一下",
        r"嗎",
        r"\?",
        r"？",
    ]

    for pat in bad_patterns:
        x = re.sub(pat, " ", x, flags=re.IGNORECASE)

    x = re.sub(r"\s+", " ", x).strip(" ，,。.;；：:")

    if not x or x in {"資料", "網站", "其他", "再查", "查", "有沒有資料"}:
        return ""

    if len(x.replace(" ", "")) < 2:
        return ""

    return x


def pick_external_search_query(
    user_q: str,
    retrieval_query: str,
    session: dict | None,
    state: Dict[str, Any],
) -> str:
    cleaned = _clean_external_followup_topic(retrieval_query)
    if cleaned:
        return cleaned

    hs = _build_history_summary(user_q, session, state) or ""
    if hs.strip() and "未明確主題" not in hs and "目前主題" not in hs:
        cleaned_hs = _clean_external_followup_topic(hs)
        if cleaned_hs:
            return cleaned_hs

    messages = []
    if isinstance(session, dict):
        val = session.get("messages")
        if isinstance(val, list):
            messages = val

    bad_words = [
        "其他網站", "查其他網站", "再查其他網站",
        "外部網站", "網站資料", "網路資料", "有沒有資料",
    ]

    medical_keywords = [
        "椎間盤", "退化", "骨質疏鬆", "骨鬆", "骨折", "關節炎",
        "腰椎", "頸椎", "胸椎", "脊椎", "疼痛", "治療", "診斷",
        "intervertebral", "disc", "degeneration", "osteoporosis",
        "fracture", "arthritis", "spine", "lumbar", "cervical",
    ]

    for m in reversed(messages):
        if isinstance(m, dict):
            role = str(m.get("role") or "").lower()
            text = str(m.get("content") or "").strip()
        else:
            role = str(getattr(m, "role", "") or "").lower()
            text = str(getattr(m, "content", "") or "").strip()

        if not text:
            continue
        if text.strip() == user_q.strip():
            continue
        if any(b in text for b in bad_words):
            continue

        for kw in medical_keywords:
            if kw.lower() in text.lower():
                return text[:120]

        if role == "user" and 2 <= len(text) <= 120:
            return text

    return ""
    
def _clean_external_followup_topic(text: str) -> str:
    """
    把「再查其他網站有沒有資料」這種操作句清掉。
    只留下可能的醫療主題。
    """
    x = str(text or "").strip()
    if not x:
        return ""

    bad_patterns = [
        r"再查其他網站有沒有資料",
        r"再查其他的網站",
        r"可以再查其他網站嗎",
        r"查其他網站",
        r"其他網站",
        r"外部網站",
        r"網站資料",
        r"網路資料",
        r"有沒有資料",
        r"還有資料嗎",
        r"可以再查",
        r"幫我查",
        r"查一下",
        r"嗎",
        r"\?",
        r"？",
    ]

    for pat in bad_patterns:
        x = re.sub(pat, " ", x, flags=re.IGNORECASE)

    x = re.sub(r"\s+", " ", x).strip(" ，,。.;；：:")

    bad_leftovers = [
        "有沒有資料",
        "資料",
        "網站",
        "其他",
        "再查",
        "查",
    ]

    if not x:
        return ""

    if x in bad_leftovers:
        return ""

    if len(x.replace(" ", "")) < 2:
        return ""

    return x


def pick_external_search_query(
    user_q: str,
    retrieval_query: str,
    session: dict | None,
    state: Dict[str, Any],
) -> str:
    """
    使用者問「再查其他網站」時，真正要查的是上一輪醫療主題，
    不是「有沒有資料」這種操作句。
    """

    # 1. 先試 retrieval_query 清洗後是否仍有主題
    cleaned = _clean_external_followup_topic(retrieval_query)
    if cleaned:
        return cleaned

    # 2. 再試 history summary
    hs = _build_history_summary(user_q, session, state) or ""
    if (
        hs.strip()
        and "未明確主題" not in hs
        and "目前主題" not in hs
    ):
        cleaned_hs = _clean_external_followup_topic(hs)
        if cleaned_hs:
            return cleaned_hs

    # 3. 從 session messages 往前找上一輪 user 問題
    messages = []
    if isinstance(session, dict):
        for key in ["messages", "history", "chat_history", "dialog", "conversation"]:
            val = session.get(key)
            if isinstance(val, list):
                messages = val
                break

    bad_words = [
        "其他網站",
        "查其他網站",
        "再查其他網站",
        "外部網站",
        "網站資料",
        "網路資料",
        "有沒有資料",
    ]

    medical_keywords = [
        "椎間盤", "退化", "骨質疏鬆", "骨鬆", "骨折", "關節炎",
        "腰椎", "頸椎", "胸椎", "脊椎", "疼痛", "治療", "診斷",
        "intervertebral", "disc", "degeneration", "osteoporosis",
        "fracture", "arthritis", "spine", "lumbar", "cervical",
    ]

    for m in reversed(messages):
        if not isinstance(m, dict):
            continue

        text = str(
            m.get("content")
            or m.get("message")
            or m.get("text")
            or ""
        ).strip()

        if not text:
            continue

        if text.strip() == user_q.strip():
            continue

        if any(b in text for b in bad_words):
            continue

        # 優先抓明確醫療詞
        for kw in medical_keywords:
            if kw.lower() in text.lower():
                # 如果句子太長，抓附近即可；先簡單回整句
                return text[:120]

        # 上一輪 user 問句通常可以當主題
        role = str(m.get("role") or "").lower()
        if role == "user" and 2 <= len(text) <= 120:
            return text

    # 4. 最後真的抓不到，就回空，不要拿「有沒有資料」去搜
    return ""

def prepare_auto_fusion_answer(
    user_q: str,
    session: dict | None = None,
    dialog_state: Optional[Dict[str, Any]] = None,
    pubmed_max_results: int = 3,
    soap_max_results: int = 2,
    vector_top_k: int = 3,
    response_language: str = "zh-TW",
    
) -> Tuple[str, str, List[Dict[str, Any]]]:
    
    
    user_q = (user_q or "").strip()
    if not user_q:
        raise ValueError("empty question")

    # 先建立對話語境查詢，讓「前面那個、剛剛那個、同一個模型」能接上上一輪主題
    state = dialog_state or {}
    retrieval_query = _build_retrieval_query(user_q, session, state)

    # 給 intent router 用的文字：同時包含原始問題 + 上下文補強後查詢
    # 例：
    # user_q = 前面那個模型再給我一次
    # retrieval_query = 尺骨 前面那個模型再給我一次
    intent_query = f"{retrieval_query}\n{user_q}".strip()

    intent = analyze_user_intent(intent_query)
    print("[AUTO_FUSION][INTENT]", intent)
    print("[AUTO_FUSION][USER_Q]", user_q)
    print("[AUTO_FUSION][RETRIEVAL_QUERY]", retrieval_query)
    print("[AUTO_FUSION][INTENT_QUERY]", intent_query)

    # ====== 🔥 3D Intent Router 插入點 ======
    # ====== 3D Intent Router 插入點 ======
    # 只有使用者「明確想看 3D / 模型 / 位置」才開 modal
    # 避免上傳文件內容剛好提到 L1、腰椎、尺骨，就自動跳 3D
    explicit_3d_words = [
        "3d", "3D",
        "模型", "3D模型", "骨骼模型",
        "立體", "觀察", "打開", "開啟", "顯示", "看", "看看", "我要看",
        "打開模型", "開啟模型", "顯示模型","長怎樣", "看起來", "外觀",
        "前往模型", "看模型", "看骨頭", "看位置",
        "mesh", "render",
    ]

    has_explicit_3d_intent = any(w in user_q for w in explicit_3d_words)

    if intent.get("need_3d_asset") and has_explicit_3d_intent:
        # 關鍵：3D asset 查詢要用 retrieval_query，不要只用 user_q
        assets = retrieve_3d_assets(retrieval_query, limit=6)

        # 如果上下文查不到，再退回原始問題查一次
        if not assets and retrieval_query != user_q:
            assets = retrieve_3d_assets(user_q, limit=6)

        print("[AUTO_FUSION][3D_ASSETS]", assets)

        render_plan = build_multi_render_plan(retrieval_query, assets)
        print("[AUTO_FUSION][RENDER_PLAN]", render_plan)

        render_source = render_plan_source(render_plan)
        print("[AUTO_FUSION][RENDER_SOURCE]", render_source)
    else:
        render_source = None
        print(
            "[AUTO_FUSION][3D_SKIP]",
            {
                "need_3d_asset": intent.get("need_3d_asset"),
                "has_explicit_3d_intent": has_explicit_3d_intent,
                "user_q": user_q,
                "retrieval_query": retrieval_query,
            },
        )
    # ====== END ======
    # ====== 🔥 END ======

    response_language = (response_language or "zh-TW").strip()

    if response_language == "en-US":
        language_rule = (
            "You must answer in English. "
            "Even if the retrieved evidence is in Chinese, translate and explain it in natural English. "
            "Do not answer in Traditional Chinese unless the user explicitly asks for Chinese."
        )
    else:
        language_rule = (
            "請使用繁體中文回答。"
            "即使使用者輸入英文，也請維持繁體中文回答，除非系統指定 response_language 為 en-US。"
        )
    
    
    route_query = f"{user_q}\n{retrieval_query}".strip()
    selected_sources = route_sources(route_query)
    print("[AUTO_FUSION][ROUTE_QUERY]", route_query)
    print("[AUTO_FUSION][SELECTED_SOURCES]", selected_sources)

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
            pubmed_query = retrieval_query

            if is_external_site_followup(user_q):
                picked = pick_external_search_query(user_q, retrieval_query, session, state)
                if picked:
                    pubmed_query = picked

            print("[AUTO_FUSION][PUBMED_QUERY]", pubmed_query)

            pubmed_raw = retrieve_pubmed_sources(
                pubmed_query,
                max_results=pubmed_max_results,
            )

            if not pubmed_raw and pubmed_query != retrieval_query:
                pubmed_raw = retrieve_pubmed_sources(
                    retrieval_query,
                    max_results=pubmed_max_results,
                )

            if not pubmed_raw and retrieval_query != user_q:
                pubmed_raw = retrieve_pubmed_sources(
                    user_q,
                    max_results=pubmed_max_results,
                )

            evidence.extend(normalize_pubmed_sources(pubmed_raw))
        except Exception as e:
            print("auto_fusion pubmed failed:", e)
                
    if "web" in selected_sources:
        try:
            web_query = retrieval_query

            if is_external_site_followup(user_q):
                picked = pick_external_search_query(user_q, retrieval_query, session, state)
                if picked:
                    web_query = picked
                else:
                    print("[AUTO_FUSION][WEB_QUERY_SKIP] no valid previous topic")
                    web_query = ""

            print("[AUTO_FUSION][WEB_QUERY]", web_query)

            web_raw = []
            if web_query:
                web_raw = retrieve_web_sources(web_query, max_results=3)

            evidence.extend(normalize_web_sources(web_raw))
        except Exception as e:
            print("auto_fusion web failed:", e)

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

        raw_resources = []
        if render_source:
            raw_resources.insert(0, render_source)

        # ✅ 有查到 3D 模型，但沒有查到文字型 RAG 資料
        if render_source:
            system = (
                "你是骨科衛教/判讀輔助助手。\n"
                f"{language_rule}\n"
                "目前系統已成功查到與使用者問題相關的 3D 骨骼模型資源，"
                "但 vector、PubMed、SOAP 等文字型 RAG 資料不足。\n"
                "回答時不可說『沒有查到資料』或『沒有 3D 模型資訊』，"
                "而是要明確說明：已找到可供觀察的 3D 模型，但缺少可支持深入衛教或臨床判讀的文字資料。\n"
                "請根據已找到的 3D 模型資訊，協助使用者理解可觀察的骨頭位置與用途；"
                "若需要醫療判斷，仍需提醒使用者補充影像、診斷或由專業醫師評估。\n"
            )

            prompt = (
                f"【使用者原始問題】\n{user_q}\n\n"
                f"【系統推定查詢語意】\n{fallback_query}\n\n"
                f"【3D 模型資源】\n{render_source.get('snippet') or render_source}\n\n"
                "目前狀態：\n"
                "- 已找到相關 3D 骨骼模型資源，可提供前端開啟 modal 或跳轉 3D 模型頁。\n"
                "- 但沒有找到足夠的文字型 RAG 證據，例如衛教資料、PubMed 文獻或 SOAP 去識別化紀錄。\n\n"
                "請輸出：\n"
                "1) 先說明已找到可觀察的 3D 模型，不要說完全沒查到。\n"
                "2) 說明這些模型可用來觀察哪個骨頭、哪個部位或左右側。\n"
                "3) 補充一般性的骨骼學習方向，但要說明文字資料不足，不能當成診斷結論。\n"
                "4) 延伸學習問題：請設計 2～3 個與本主題相關的問題，每題獨立成一行，格式固定為：- 問題文字\n"
            )

            return system, prompt, raw_resources

        # ❌ 真的連 3D 模型也沒有、文字 RAG 也沒有
        system = (
            "你是骨科衛教/判讀輔助助手。\n"
            f"{language_rule}\n"
            "目前檢索資料不足時，可以提供一般性衛教方向，"
            "但必須明確說明這不是根據本次檢索資料得出的結論，且不可捏造文獻或個案資料。"
            "提出延伸學習問題：請設計 2～3 個與本主題相關的問題，每題獨立成一行，格式固定為：- 問題文字\n"
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

        return system, prompt, raw_resources
        

    history_summary = _build_history_summary(user_q, session, state)
    context = format_evidence_for_prompt(evidence)

    system = (
        "你是 GalaBone 專業骨科衛教專家。你的目標是基於『權威醫學指引』與『病患個人數據』進行分析。\n"
        f"{language_rule}\n"
        "【回答規則】\n"
    "1. 強制引用：回答的每一項關鍵建議，必須在結尾標註資料來源（例如：根據《2025 退行性腰椎滑脱症診療指南》...）。\n"
    "2. 證據層級：優先引用醫學指南、臨床研究文獻（PubMed）、最後才是衛教常識。\n"
    "3. 結構化回覆：\n"
    "   - 【醫學機轉分析】：直接說明該部位解剖結構與病變之間的關聯。\n"
    "   - 【臨床依據】：引用檢索到的文獻支持你的說法。\n"
    "   - 【醫病溝通建議】：針對病患現有的病歷摘要，給出具體的行為建議。\n"
    "4. 若檢索資料中有衝突，請明確指出哪些來源支持哪種觀點。\n"
    "5. 禁止回答模糊不清、沒有根據的空話。\n"
    "【專業守則】若涉及醫學診斷結論，必須語氣審慎，但不能因為怕而不敢給出醫學上的解釋。\n"
        "你會收到多來源 RAG 檢索資料，來源可能包含 vector、soap、pubmed、web。\n"
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
        "RAG 檢索資料來源名稱必須寫出來，只能使用：（來源：GalaBone 衛教資料庫）、（來源：PubMed 文獻）、（來源：輔大醫院授權之去識別化醫囑紀錄表）、（來源：可信醫療網站資料）。\n"
"若來源類型為 web，代表系統已嘗試從可信醫療網站搜尋並擷取頁面文字；"
"若該筆 web evidence 的內容明確且 fetched=True，可作為可信衛教來源輔助說明，"
"但仍不可取代醫師診斷或臨床指引。\n"
"請依據實際使用的檢索資料標註來源，不可隨意標註，也不可全部標成同一來源。\n"
    )

    prompt = (
        f"【對話狀態摘要】\n{history_summary or '（無）'}\n\n"
        f"【使用者問題】\n{user_q}\n\n"
        f"【多來源檢索資料】\n{context}\n\n"
        "回答時，請根據不同來源內容分別引用，例如：\n"

"不可全部只標註同一來源。\n"
"請輸出：\n"
"1) 綜合回答（需直接回應問題核心，不可只提供通用知識）\n"
"2) 判讀/衛教重點（如使用者未要求列點，可簡短帶過）\n"
"3) 注意事項（不確定就明確說不確定；若不需要可簡短帶過）\n"
"4) 延伸學習問題：請設計 2～3 個與本主題相關的進階問題，幫助使用者深入理解，問題需具體且具學習價值。\n"
"每題必須獨立成一行，格式固定為：- 問題文字\n"
"問題不要加編號，不要加來源，不要加解釋。\n"
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
    "site_name": item.get("site_name"),
    "is_search_entry": item.get("is_search_entry"),

    # 這兩個一定要補，不然前端看不到是否真的抓到網頁正文
    "fetched": item.get("fetched"),
    "search_topic": item.get("search_topic"),
})
        
    if render_source:
        raw_resources.insert(0, render_source)

    return system, prompt, raw_resources