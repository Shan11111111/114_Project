# s2_agent/legacy_agent/backend/app/tools/web_tool.py
from __future__ import annotations

import re
import time
import requests
from bs4 import BeautifulSoup
from typing import Any, Dict, List
from urllib.parse import urlparse


try:
    from duckduckgo_search import DDGS
except Exception:
    DDGS = None


TRUSTED_MEDICAL_SITES = [
    {
        "site_name": "AAOS OrthoInfo",
        "domain": "orthoinfo.aaos.org",
        "desc": "美國骨科醫學會 AAOS 的病患衛教網站，適合查骨科疾病、骨折、關節、手術與復健衛教。",
    },
    {
        "site_name": "Mayo Clinic",
        "domain": "mayoclinic.org",
        "desc": "Mayo Clinic 醫療衛教網站，適合查疾病介紹、症狀、治療方式與用藥概念。",
    },
    {
        "site_name": "Cleveland Clinic",
        "domain": "clevelandclinic.org",
        "desc": "Cleveland Clinic 健康資訊網站，適合查疾病、症狀、治療與病患衛教。",
    },
    {
        "site_name": "MedlinePlus",
        "domain": "medlineplus.gov",
        "desc": "美國國家醫學圖書館 MedlinePlus，適合查病患導向的醫療衛教資料。",
    },
    {
        "site_name": "衛生福利部",
        "domain": "mohw.gov.tw",
        "desc": "台灣衛生福利部官方網站，適合查政策、公告與官方衛教資訊。",
    },
    {
        "site_name": "國民健康署",
        "domain": "hpa.gov.tw",
        "desc": "台灣國民健康署官方網站，適合查健康促進、慢性病與公共衛生衛教資訊。",
    },
]


META_WEB_PATTERNS = [
    r"目前主題\s*[:：]\s*未明確主題",
    r"目前主題\s*[:：]",
    r"未明確主題",
    r"對話狀態摘要",
    r"使用者問題",
    r"系統推定查詢語意",
    r"可以再查其他網站嗎",
    r"能不能再查其他網站",
    r"再查其他網站",
    r"查其他網站",
    r"其他網站",
    r"外部網站",
    r"可信網站",
    r"網路資料",
    r"網站資料",
    r"再查其他的網站",
    r"可以再查",
    r"幫我查",
    r"查一下",
    r"請查",
    r"請幫我查",
    r"嗎",
    r"\?",
    r"？",
]


BAD_WEB_QUERY_KEYWORDS = [
    "目前主題",
    "未明確主題",
    "對話狀態摘要",
    "使用者問題",
    "系統推定查詢語意",
    "可以再查其他網站",
    "查其他網站",
    "其他網站",
    "外部網站",
    "可信網站",
    "網站資料",
    "網路資料",
]


def _domain_allowed(url: str) -> bool:
    try:
        host = urlparse(url).netloc.lower()
        return any(site["domain"] in host for site in TRUSTED_MEDICAL_SITES)
    except Exception:
        return False


def _site_name_from_url(url: str) -> str:
    host = urlparse(url).netloc.lower()

    for site in TRUSTED_MEDICAL_SITES:
        if site["domain"] in host:
            return site["site_name"]

    return "可信醫療網站"


def _looks_like_bad_query(text: str) -> bool:
    x = (text or "").strip()
    if not x:
        return True

    if any(bad in x for bad in BAD_WEB_QUERY_KEYWORDS):
        return True

    compact = re.sub(r"\s+", "", x)
    if re.fullmatch(r"(可以|再|查|網站|其他|資料|外部|可信|幫我|請)+", compact):
        return True

    if len(compact) < 2:
        return True

    return False


def _clean_web_query(query: str) -> str:
    """
    把使用者操作句清掉，只留下醫療主題。
    例：
    椎間盤退化 再查其他網站
    -> 椎間盤退化
    """
    q = (query or "").strip()
    if not q:
        return ""

    lines = [x.strip() for x in q.splitlines() if x.strip()]
    cleaned_candidates: List[str] = []

    for line in lines or [q]:
        x = line.strip()

        # 先移除 meta 詞，不要一看到「其他網站」就整句丟掉
        for pat in META_WEB_PATTERNS:
            x = re.sub(pat, " ", x, flags=re.IGNORECASE)

        x = re.sub(r"\s+", " ", x).strip(" ，,。.;；：:")

        if not _looks_like_bad_query(x):
            cleaned_candidates.append(x)

    medical_keywords = [
        "骨", "椎", "關節", "肌腱", "韌帶", "退化", "骨折", "骨鬆",
        "骨質疏鬆", "椎間盤", "疼痛", "發炎", "手術", "治療", "診斷",
        "intervertebral", "disc", "degeneration", "fracture",
        "osteoporosis", "arthritis", "spine", "lumbar", "cervical",
        "thoracic", "treatment", "diagnosis",
    ]

    for x in cleaned_candidates:
        xl = x.lower()
        if any(k.lower() in xl for k in medical_keywords):
            return x

    if cleaned_candidates:
        return cleaned_candidates[0]

    return ""


def _search_trusted_sites(query: str, max_results: int = 6) -> List[Dict[str, Any]]:
    """
    用 DuckDuckGo 搜尋可信醫療網站。
    不需要 API key，但可能被限流。
    """
    if DDGS is None:
        print("[WEB_TOOL] duckduckgo_search not installed.")
        return []

    site_filter = " OR ".join([f"site:{s['domain']}" for s in TRUSTED_MEDICAL_SITES])
    search_q = f"{query} ({site_filter})"

    print("[WEB_TOOL][SEARCH_Q]", search_q)

    results: List[Dict[str, Any]] = []

    try:
        with DDGS() as ddgs:
            for r in ddgs.text(
                search_q,
                region="wt-wt",
                safesearch="moderate",
                max_results=max_results * 2,
            ):
                url = str(r.get("href") or r.get("url") or "").strip()
                title = str(r.get("title") or "").strip()
                snippet = str(r.get("body") or r.get("snippet") or "").strip()

                if not url:
                    continue

                if not _domain_allowed(url):
                    continue

                results.append({
                    "title": title or _site_name_from_url(url),
                    "url": url,
                    "snippet": snippet,
                    "site_name": _site_name_from_url(url),
                })

                if len(results) >= max_results:
                    break

    except Exception as e:
        print("[WEB_TOOL] DuckDuckGo search failed:", e)
        return []

    return results


def _extract_main_text(html: str) -> str:
    soup = BeautifulSoup(html or "", "lxml")

    for tag in soup(["script", "style", "noscript", "header", "footer", "nav", "aside"]):
        tag.decompose()

    candidates = []

    for selector in [
        "article",
        "main",
        "[role='main']",
        ".content",
        ".main-content",
        ".article",
        ".entry-content",
    ]:
        for node in soup.select(selector):
            text = node.get_text(" ", strip=True)
            if len(text) > 300:
                candidates.append(text)

    if candidates:
        text = max(candidates, key=len)
    else:
        text = soup.get_text(" ", strip=True)

    text = re.sub(r"\s+", " ", text).strip()

    # 避免 prompt 爆掉，抓前段就好
    return text[:3500]


def _fetch_page_text(url: str, timeout: int = 10) -> str:
    if not _domain_allowed(url):
        return ""

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0 Safari/537.36"
        ),
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    }

    try:
        resp = requests.get(url, headers=headers, timeout=timeout)
        resp.raise_for_status()

        ctype = resp.headers.get("content-type", "").lower()
        if "text/html" not in ctype and "application/xhtml" not in ctype:
            return ""

        return _extract_main_text(resp.text)

    except Exception as e:
        print("[WEB_TOOL] fetch failed:", url, e)
        return ""


def retrieve_web_sources(
    query: str,
    max_results: int = 3,
) -> List[Dict[str, Any]]:
    """
    真正去可信醫療網站搜尋並抓網頁內容。
    回傳的 content 會進入 RAG evidence。
    """
    raw_query = (query or "").strip()
    search_topic = _clean_web_query(raw_query)

    if not search_topic:
        print("[WEB_TOOL] no valid medical topic, skip. raw_query =", raw_query)
        return []

    search_results = _search_trusted_sites(search_topic, max_results=max_results * 2)

    if not search_results:
        print("[WEB_TOOL] no search results. topic =", search_topic)
        return []

    out: List[Dict[str, Any]] = []
    seen_urls = set()

    for item in search_results:
        url = item.get("url", "")
        if not url or url in seen_urls:
            continue

        seen_urls.add(url)

        page_text = _fetch_page_text(url)

        # 如果全文抓不到，至少保留搜尋摘要；但標記 fetched=False
        snippet = item.get("snippet") or ""
        content = page_text or snippet

        if not content:
            continue

        out.append({
            "source_type": "web",
            "title": item.get("title") or f"{item.get('site_name')}：可信醫療網站資料",
            "url": url,
            "download_url": url,
            "external_url": url,
            "snippet": content[:350],
            "content": content,
            "score": 0.72 if page_text else 0.55,
            "site_name": item.get("site_name") or _site_name_from_url(url),
            "is_search_entry": False,
            "fetched": bool(page_text),
            "search_topic": search_topic,
            "raw_query": raw_query,
        })

        print("[WEB_TOOL][FETCHED]", {
            "url": url,
            "site": item.get("site_name"),
            "chars": len(content),
            "fetched": bool(page_text),
        })

        if len(out) >= max_results:
            break

        time.sleep(0.4)

    return out