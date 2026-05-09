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
    """
    三工具路由版本：
    - vector：骨骼教材 / 衛教資料 / 解剖學習
    - pubmed：研究文獻 / 治療 / 用藥 / 指引 / 臨床證據
    - soap：去識別化個案紀錄 / 主訴 / 檢查 / Assessment / Plan
    - web：先停用，不進入 auto_fusion
    """
    q = (query or "").lower()
    sources = set()

    # 1) SOAP：個案、病歷、主訴、檢查、處置、S/O/A/P
    if any(k in q for k in [
        "病人", "個案", "案例", "主訴", "病史", "病歷", "就診",
        "soap", "s:", "o:", "a:", "p:",
        "subjective", "objective", "assessment", "plan",
        "檢查結果", "處置", "用藥紀錄", "醫囑", "追蹤",
        "這個病人", "這位病人", "患者",
    ]):
        sources.add("soap")

    # 2) PubMed：研究、文獻、治療證據、用藥、指引
    if any(k in q for k in [
        "研究", "文獻", "pubmed", "paper", "論文",
        "臨床試驗", "systematic review", "meta-analysis",
        "guideline", "治療指引", "指南",
        "藥物", "用藥", "副作用", "療效", "證據",
        "治療", "診斷", "風險", "預後",
    ]):
        sources.add("pubmed")

    # 3) Vector：骨骼學習、解剖、位置、功能、影像辨識、衛教
    if any(k in q for k in [
        "骨頭", "骨骼", "骨", "位置", "功能", "解剖", "構造",
        "介紹", "說明", "衛教", "什麼是", "是什麼", "在哪",
        "x光", "影像", "判讀", "辨認", "怎麼看",
        "怎麼記", "口訣", "差異", "比較", "不同",
        "骨質疏鬆", "骨鬆", "骨折",
        "頭顱骨", "脊椎", "頸椎", "胸椎", "腰椎",
        "鎖骨", "肩胛骨", "肱骨", "橈骨", "尺骨",
        "股骨", "脛骨", "腓骨", "髕骨", "肋骨",
    ]):
        sources.add("vector")

    # 4) 常見跨來源策略
    # 疾病 / 治療 / 用藥：教材 + 文獻
    if any(k in q for k in [
        "骨質疏鬆", "骨鬆", "骨折", "治療", "診斷",
        "風險", "用藥", "藥物", "副作用", "預後",
    ]):
        sources.update(["vector", "pubmed"])

    # 個案 + 醫療判斷：SOAP + 教材；有治療/用藥/證據再加 PubMed
    if "soap" in sources or any(k in q for k in ["病人", "個案", "患者", "病歷", "就診"]):
        sources.add("vector")
        if any(k in q for k in ["治療", "用藥", "藥物", "副作用", "證據", "指引", "診斷"]):
            sources.add("pubmed")

    # 5) 使用者說「其他網站」時，先不要查 web，改成 PubMed
    if any(k in q for k in [
        "其他網站", "外部網站", "網站資料", "網路資料", "可信網站",
        "官方網站", "查網站", "再查其他網站",
    ]):
        sources.add("pubmed")

    if not sources:
        sources.add("vector")

    # 保險：目前 web 停用
    sources.discard("web")

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
            "title": f"輔大醫院授權之去識別化醫囑紀錄表（個案 {len(out) + 1}）",
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

def is_persona_chat_request(user_q: str) -> bool:
    """
    判斷使用者是不是在問小罐頭角色設定 / 閒聊。
    這類問題不需要硬查 RAG，否則會因為查不到 evidence 而變成「資料不足」。
    """
    q = (user_q or "").strip().lower()

    persona_words = [
        # "小罐頭",
        # "bone寶",
        # "bone 宝",
        "你是誰",
        "你是什麼",
        "你叫什麼",
        "你的名字",
        "你的設定",
        "你的個性",
        "你的角色",
        "你喜歡",
        "喜歡吃什麼",
        "吃什麼",
        "興趣",
        "你會吃",
        "你怕什麼",
        "你最喜歡",
        "罐頭喜歡",
        "罐頭吃",
        "galaBone rag",
        "galabone rag",
        "who are you",
        "what do you like",
        "favorite food",
        "what do you eat",
        "your personality",
        "your character",
    ]

    return any(w in q for w in persona_words)

def build_persona_chat_prompt(user_q: str, language_rule: str) -> Tuple[str, str]:
    system = (
        "你是 GalaBone 系統裡的「知識小罐頭 GalaBone RAG」。\n"
        "你是一個有個性的骨骼學習助教，親切、可愛、鼓勵學生，但仍然要專業。\n"
        f"{language_rule}\n"
        "你可以自稱「小罐頭」，但不要每句都重複。\n"
        "如果使用者問你的喜好、喜歡吃什麼、興趣、角色設定或日常問題，請用角色扮演方式回答。\n"
        "你必須說明：小罐頭是 AI 角色，不是真的會吃東西。\n"
        "小罐頭的角色設定：\n"
        "- 最喜歡吃：鈣質滿滿的知識點。\n"
        "- 主餐：骨骼解剖。\n"
        "- 點心：PubMed 文獻。\n"
        "- 飯後甜點：小測驗。\n"
        "- 飲料：Bone寶 推薦的牛奶。\n"
        "- 最怕吃：沒有來源的亂講話。\n"
        "回答要短一點、可愛一點，但不要太浮誇。\n"
        "如果使用者問醫療、骨骼、診斷、治療、用藥，請回到專業骨骼學習助教模式。\n"
    )

    prompt = (
        f"【使用者問題】\n{user_q}\n\n"
        "請用知識小罐頭的角色設定回答。"
    )

    return system, prompt

def is_quiz_or_card_request(user_q: str) -> str:
    """
    回傳：
    - quiz：使用者要測驗 / 題目
    - card：使用者要學習卡 / 複習卡
    - ""：一般問答
    """
    q = (user_q or "").strip().lower()

    quiz_words = [
        "出題", "題目", "測驗", "測試", "考我", "練習題",
        "選擇題", "簡答題", "判斷題", "quiz", "exam", "test",
    ]

    card_words = [
        "學習卡", "複習卡", "記憶卡", "flashcard", "flashcards",
        "幫我整理成卡片", "做成卡片",
    ]

    if any(w in q for w in quiz_words):
        return "quiz"

    if any(w in q for w in card_words):
        return "card"

    return ""


def build_learning_prompt_from_evidence(
    *,
    user_q: str,
    history_summary: str,
    context: str,
    language_rule: str,
    mode: str,
) -> Tuple[str, str]:
    """
    根據已檢索 evidence 產生：
    - 一般骨骼學習回答
    - 測驗題目
    - 學習卡
    """

    base_system = (
    "你是 GalaBone 系統裡的「知識小罐頭 GalaBone RAG」，是一位親切、有一點可愛但仍然專業的骨骼學習助教。\n"
    "你的角色設定：\n"
    "- 你可以自稱「小罐頭」，但不要每一句都重複自稱，避免影響閱讀。\n"
"- 你的語氣要像陪學生複習的學習夥伴：清楚、鼓勵、好懂，不要冷冰冰。\n"
"- 一般骨骼學習回答的開頭，請優先用一句親切引導，例如「小罐頭幫你抓重點！」、「這題很適合用位置來記，小罐頭整理給你！」。\n"
"- 回答骨骼知識時要保持專業，尤其涉及診斷、治療、用藥、個案判讀時，語氣要穩重，不可開玩笑過頭。\n"
"- 可以偶爾使用輕鬆語氣，但不能讓回答變得不嚴謹；正式醫療提醒仍要清楚、保守。\n"
    "- 如果查不到資料，要誠實說明「小罐頭目前沒有找到足夠資料」，不可硬編。\n"
    "- 如果使用者問你的喜好、喜歡吃什麼、興趣或日常設定，可以用角色扮演方式回答，但要說明你不是真的會吃東西。\n"
    "- 小罐頭的角色喜好可以設定為：喜歡吃『鈣質滿滿的知識點』，主餐是骨骼解剖，點心是 PubMed 文獻，飯後甜點是小測驗。\n"
    "- 這類閒聊可以可愛一點，但不要影響正式骨科知識回答的準確性。\n"
    "\n"
    "你的任務是把三類資料整合成適合學習的回答：\n"
    "1) GalaBone 衛教資料庫：用於骨頭名稱、位置、功能、解剖關係、影像辨識與基礎衛教。\n"
    "2) PubMed 文獻：用於研究證據、治療、用藥、副作用、診斷方法、臨床指引或風險/預後。\n"
    "3) 去識別化 SOAP 個案紀錄：用於個案觀察、主訴、檢查、Assessment、Plan 與臨床情境學習。\n"
    f"{language_rule}\n"
    "回答或出題都必須根據實際檢索資料，不得捏造資料中沒有的內容。\n"
    "整合資料時請遵守：教材資料負責建立基礎理解；PubMed 負責補充研究證據；SOAP 只作為去識別化個案範例，不可直接當成通用醫療結論。\n"
    "若問題涉及診斷、治療、用藥或個案判讀，請補充醫療注意事項，但不得直接取代醫師判斷。\n"
    "若回答中第一次出現重要骨科、影像、藥物或檢查名詞，請補上英文專有名詞。\n"
    "來源名稱只能使用：（來源：GalaBone 衛教資料庫）、（來源：PubMed 文獻）、（來源：輔大醫院授權之去識別化醫囑紀錄表）。\n"
    "不可自作主張把所有內容都標成同一來源，必須依實際 evidence 標註。\n"
)

    if mode == "quiz":
        system = (
            base_system
            + "你的本輪任務不是一般回答，而是根據檢索資料幫學生設計骨骼學習測驗。\n"
            + "題目必須能測出學生是否理解骨頭位置、功能、解剖關係、影像辨識或臨床意義。\n"
        )

        prompt = (
            f"【對話狀態摘要】\n{history_summary or '（無）'}\n\n"
            f"【使用者需求】\n{user_q}\n\n"
            f"【多來源檢索資料】\n{context}\n\n"
            "請根據檢索資料設計骨骼學習測驗。\n"
            "請只輸出合法 JSON，不要輸出 Markdown，不要加 ```，不要加任何 JSON 外的說明文字。\n"
            "JSON 格式必須完全符合以下 schema：\n"
            "{\n"
            '  "mode": "quiz",\n'
            '  "title": "骨骼學習測驗",\n'
            '  "questions": [\n'
            "    {\n"
            '      "id": "q1",\n'
            '      "type": "single_choice",\n'
            '      "question": "題目文字",\n'
            '      "options": [\n'
            '        {"key": "A", "text": "選項 A"},\n'
            '        {"key": "B", "text": "選項 B"},\n'
            '        {"key": "C", "text": "選項 C"},\n'
            '        {"key": "D", "text": "選項 D"}\n'
            "      ],\n"
            '      "answer": "B",\n'
            '      "explanation": "解析文字",\n'
            '      "source_hint": "GalaBone 衛教資料庫 / PubMed 文獻 / SOAP 個案紀錄"\n'
            "    }\n"
            "  ]\n"
            "}\n\n"
            "規則：\n"
            "1) 請出 5 題。\n"
            "2) 至少 3 題 single_choice、1 題 true_false、1 題 short_answer。\n"
            "3) single_choice 必須有 A/B/C/D 四個選項，answer 必須是 A/B/C/D 其中一個。\n"
            "4) true_false 的 options 必須是 [{\"key\":\"O\",\"text\":\"正確\"},{\"key\":\"X\",\"text\":\"錯誤\"}]，answer 必須是 O 或 X。\n"
            "5) short_answer 的 options 請給空陣列 []，answer 請盡量簡短，方便前端比對。\n"
            "6) 題目必須貼近骨頭學習，例如位置、功能、相鄰構造、影像辨識、臨床意義。\n"
            "7) 每題都要有 explanation。\n"
            "8) 解析必須根據檢索資料，不可自行腦補。\n"
            "9) 如果資料不足以支持某題，請改出較保守的基礎理解題。\n"
            "10) 最外層第一個字元必須是 {，最後一個字元必須是 }。\n"
"11) 不要使用 Markdown 標題，例如 ### 題目 1。\n"
"12) 不要在 JSON 前後加任何說明、鼓勵文字或結語。\n"
"13) 若無法產生完整 5 題，也必須回傳合法 JSON，不可改成 Markdown。\n"
        )

        return system, prompt

    if mode == "card":
        system = (
            base_system
            + "你的本輪任務不是一般回答，而是根據檢索資料幫學生設計骨骼學習卡。\n"
            + "學習卡要幫助學生快速複習骨頭名稱、位置、功能、辨認方式與臨床意義。\n"
        )

        prompt = (
            f"【對話狀態摘要】\n{history_summary or '（無）'}\n\n"
            f"【使用者需求】\n{user_q}\n\n"
            f"【多來源檢索資料】\n{context}\n\n"
            "請根據檢索資料製作 5 張學習卡，規則如下：\n"
            "1) 每張卡片用 `### 卡片 {n}` 開頭。\n"
            "2) 每張卡片包含：學習重點、記憶提示、容易混淆處。\n"
            "3) 每張卡片 200 字以內。\n"
            "4) 必須貼近骨頭學習，不要只寫泛用衛教。\n"
            "5) 不可捏造檢索資料沒有的內容。\n"
        )

        return system, prompt

    system = (
        base_system
        + "你的本輪任務是根據檢索資料回答使用者問題，並協助其建立骨骼學習理解。\n"
    )

    prompt = (
        f"【對話狀態摘要】\n{history_summary or '（無）'}\n\n"
        f"【使用者問題】\n{user_q}\n\n"
        f"【多來源檢索資料】\n{context}\n\n"
        "請輸出固定四個區塊，標題請使用純文字，不要使用 Markdown 粗體符號 **：\n"
"1) 綜合回答\n"
"第一句請用小罐頭的親切語氣開場，例如「小罐頭幫你抓重點！」或「這題很適合用位置來記，小罐頭整理給你！」。\n"
"接著直接回應使用者問題核心，優先說明骨頭名稱、位置、功能、解剖關係、影像辨識特徵或臨床意義。\n"
"語氣要像在陪學生理解，不要像冷冰冰的百科條目。\n\n"
"2) 骨骼學習重點\n"
"用 3～5 點整理，讓學生知道該怎麼記、怎麼分辨。\n\n"
"3) 注意事項\n"
"若涉及診斷、治療、用藥或個案判讀，請提醒資料限制與醫師判斷必要性。\n\n"
"4) 延伸學習問題\n"
"設計 2～3 個具體問題，每題獨立成一行，格式固定為：- 問題文字\n\n"
"格式限制：\n"
"- 不要使用 **粗體**。\n"
"- 不要輸出 raw evidence、score、chunk、內部來源編號。\n"
"- 標題請維持 1)、2)、3)、4) 開頭，方便前端解析。\n"
"- 不要整篇都很制式；可以保留一點小罐頭個性，但不能影響專業正確性。\n"
    )

    return system, prompt

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
        # 角色閒聊 / 小罐頭設定：不要硬走 RAG
        # 先判斷是不是學習任務。
    # 例如「小罐頭幫我出題」同時有小罐頭 + 出題，
    # 這種應該走 quiz，不應該被 persona 分流吃掉。
    early_learning_mode = is_quiz_or_card_request(user_q)

    # 角色閒聊 / 小罐頭設定：不要硬走 RAG
    # 只有「不是出題 / 不是學習卡」時，才進 persona。
    if not early_learning_mode and is_persona_chat_request(user_q):
        system, prompt = build_persona_chat_prompt(user_q, language_rule)
        return system, prompt, []
    
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
                
    # web tool 目前先停用，專注 vector / PubMed / SOAP 三工具
    if "web" in selected_sources:
        print("[AUTO_FUSION][WEB_DISABLED] web tool is disabled for now.")

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

        #  有查到 3D 模型，但沒有查到文字型 RAG 資料
        if render_source:
            learning_mode = is_quiz_or_card_request(user_q)

            system = (
                "你是 GalaBone 骨骼學習助教。你的任務是協助使用者理解骨頭名稱、位置、功能、解剖關係、影像辨識特徵與相關臨床意義。\n"
                f"{language_rule}\n"
                "目前系統已成功查到與使用者問題相關的 3D 骨骼模型資源，"
                "但沒有找到足夠的文字型 RAG 證據，例如: 衛教資料(vector)、PubMed 文獻(PubMed)、輔大醫院授權之去識別化醫囑紀錄表(soap)。\n"
                "回答時不可說『完全沒有資料』或『沒有 3D 模型資訊』，"
                "而是要明確說明：已找到可供觀察的 3D 模型，但缺少可支持深入衛教、文獻或個案分析的文字資料。\n"
                "請根據已找到的 3D 模型資訊，協助使用者理解可觀察的骨頭位置、左右側、相鄰構造與學習用途。\n"
                "若涉及診斷、治療或用藥，必須提醒不可取代醫師判斷。\n"
            )

            if learning_mode == "quiz":
                prompt = (
    f"【使用者原始需求】\n{user_q}\n\n"
    f"【系統推定查詢語意】\n{fallback_query}\n\n"
    f"【3D 模型資源】\n{render_source.get('snippet') or render_source}\n\n"
    "目前只有 3D 模型資源，文字型 RAG 證據不足。\n"
    "請根據 3D 模型資訊設計 3 題保守的骨骼觀察題。\n"
    "請只輸出合法 JSON，不要輸出 Markdown，不要加 ```，不要加任何 JSON 外的說明文字。\n"
    "JSON 格式必須完全符合以下 schema：\n"
    "{\n"
    '  "mode": "quiz",\n'
    '  "title": "3D 骨骼模型觀察題",\n'
    '  "questions": [\n'
    "    {\n"
    '      "id": "q1",\n'
    '      "type": "single_choice",\n'
    '      "question": "題目文字",\n'
    '      "options": [\n'
    '        {"key": "A", "text": "選項 A"},\n'
    '        {"key": "B", "text": "選項 B"},\n'
    '        {"key": "C", "text": "選項 C"},\n'
    '        {"key": "D", "text": "選項 D"}\n'
    "      ],\n"
    '      "answer": "A",\n'
    '      "explanation": "解析文字",\n'
    '      "source_hint": "3D 模型資源"\n'
    "    }\n"
    "  ]\n"
    "}\n\n"
    "規則：\n"
    "1) 請出 3 題。\n"
    "2) 題目要聚焦在骨頭位置、外觀、左右側或相鄰構造。\n"
    "3) single_choice 必須有 A/B/C/D 四個選項，answer 必須是 A/B/C/D 其中一個。\n"
    "4) 每題都要有 explanation。\n"
    "5) 不可捏造模型資訊以外的疾病或治療內容。\n"
    "6) 最外層第一個字元必須是 {，最後一個字元必須是 }。\n"
)
            elif learning_mode == "card":
                prompt = (
                    f"【使用者原始需求】\n{user_q}\n\n"
                    f"【系統推定查詢語意】\n{fallback_query}\n\n"
                    f"【3D 模型資源】\n{render_source.get('snippet') or render_source}\n\n"
                    "目前只有 3D 模型資源，文字型 RAG 證據不足。\n"
                    "請製作 3 張 3D 骨骼觀察學習卡：\n"
                    "1) 每張卡片用 `### 卡片 {n}` 開頭。\n"
                    "2) 每張包含：觀察重點、記憶提示、容易混淆處。\n"
                    "3) 不可捏造模型資訊以外的疾病或治療內容。\n"
                )
            else:
                prompt = (
                    f"【使用者原始問題】\n{user_q}\n\n"
                    f"【系統推定查詢語意】\n{fallback_query}\n\n"
                    f"【3D 模型資源】\n{render_source.get('snippet') or render_source}\n\n"
                    "目前狀態：\n"
                    "- 已找到相關 3D 骨骼模型資源，可提供前端開啟 modal 或跳轉 3D 模型頁。\n"
                    "- 但沒有找到足夠的文字型 RAG 證據，例如衛教資料、PubMed 文獻、SOAP 去識別化紀錄或可信網站資料。\n\n"
                    "請輸出：\n"
                    "1) 先說明已找到可觀察的 3D 模型，不要說完全沒查到。\n"
                    "2) 說明模型可用來觀察哪個骨頭、哪個部位、左右側或相鄰構造。\n"
                    "3) 補充一般性的骨骼學習方向，但要說明文字資料不足，不能當成診斷結論。\n"
                    "4) 延伸學習問題：請設計 2～3 個與本主題相關的問題，每題獨立成一行，格式固定為：- 問題文字\n"
                )

            return system, prompt, raw_resources
        
        
        # ❌ 沒有文字 evidence，也沒有 3D 模型
        learning_mode = is_quiz_or_card_request(user_q)

        system = (
            "你是 GalaBone 骨骼學習助教。\n"
            f"{language_rule}\n"
            "目前小罐頭沒有檢索到足夠資料，也沒有找到可用的 3D 模型資源。\n"
"你可以提供非常保守的骨骼學習方向，但必須明確說明這不是根據本次檢索資料得出的結論。\n"
"請用親切但誠實的語氣回應，例如：小罐頭目前找不到足夠資料，但可以先陪你抓一個安全的學習方向。\n"
        )

        if learning_mode == "quiz":
            prompt = (
    f"【使用者原始需求】\n{user_q}\n\n"
    f"【系統推定查詢語意】\n{fallback_query}\n\n"
    "目前沒有檢索到足夠文字資料，也沒有找到 3D 模型資源。\n"
    "請保守設計 3 題基礎骨骼學習題。\n"
    "請只輸出合法 JSON，不要輸出 Markdown，不要加 ```，不要加任何 JSON 外的說明文字。\n"
    "JSON 格式必須完全符合以下 schema：\n"
    "{\n"
    '  "mode": "quiz",\n'
    '  "title": "基礎骨骼學習題",\n'
    '  "questions": [\n'
    "    {\n"
    '      "id": "q1",\n'
    '      "type": "single_choice",\n'
    '      "question": "題目文字",\n'
    '      "options": [\n'
    '        {"key": "A", "text": "選項 A"},\n'
    '        {"key": "B", "text": "選項 B"},\n'
    '        {"key": "C", "text": "選項 C"},\n'
    '        {"key": "D", "text": "選項 D"}\n'
    "      ],\n"
    '      "answer": "A",\n'
    '      "explanation": "解析文字",\n'
    '      "source_hint": "基礎骨骼學習"\n'
    "    }\n"
    "  ]\n"
    "}\n\n"
    "規則：\n"
    "1) 請出 3 題。\n"
    "2) 開頭不要額外說明資料不足，資料不足請寫在 explanation 或 source_hint 裡。\n"
    "3) 題目必須是一般骨骼學習方向，不可假裝有文獻、教材或模型依據。\n"
    "4) single_choice 必須有 A/B/C/D 四個選項，answer 必須是 A/B/C/D 其中一個。\n"
    "5) 每題都要有 explanation。\n"
    "6) 最外層第一個字元必須是 {，最後一個字元必須是 }。\n"
)
        elif learning_mode == "card":
            prompt = (
                f"【使用者原始需求】\n{user_q}\n\n"
                f"【系統推定查詢語意】\n{fallback_query}\n\n"
                "目前沒有檢索到足夠文字資料，也沒有找到 3D 模型資源。\n"
                "請保守製作 3 張基礎骨骼學習卡：\n"
                "1) 開頭先說明：目前資料不足，以下卡片僅作基礎複習。\n"
                "2) 不可假裝有文獻、教材、個案或模型依據。\n"
                "3) 每張卡片用 `### 卡片 {n}` 開頭。\n"
                "4) 每張卡片包含：學習重點、記憶提示、容易混淆處。\n"
            )
        else:
            prompt = (
                f"【使用者原始問題】\n{user_q}\n\n"
                f"【系統推定查詢語意】\n{fallback_query}\n\n"
                "目前沒有檢索到足夠文字資料，也沒有找到 3D 模型資源。\n"
                "請用保守方式回答：\n"
                "1) 先明確說明資料不足。\n"
                "2) 提供一般性骨骼學習方向。\n"
                "3) 若涉及醫療判斷，提醒需要專業醫師評估。\n"
                "4) 建議使用者補充更明確的骨頭名稱、部位、影像結果、診斷或上傳文件。\n"
            )

        return system, prompt, raw_resources

    history_summary = _build_history_summary(user_q, session, state)
    context = format_evidence_for_prompt(evidence)

    learning_mode = is_quiz_or_card_request(user_q)

    system, prompt = build_learning_prompt_from_evidence(
        user_q=user_q,
        history_summary=history_summary,
        context=context,
        language_rule=language_rule,
        mode=learning_mode,
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