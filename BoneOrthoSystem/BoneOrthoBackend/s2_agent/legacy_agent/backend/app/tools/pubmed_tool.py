#s2_agent/legacy_agent/backend/app/tools/pubmed_tool.py
# pubmed_tool.py - A helper module for searching PubMed articles based on user questions.
from __future__ import annotations

import os
import re
import html
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Tuple

import requests
from dotenv import load_dotenv

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
CHAT_MODEL = os.getenv("CHAT_MODEL", "gpt-4.1-mini")

if OPENAI_API_KEY:
    from openai import OpenAI
    _client = OpenAI(api_key=OPENAI_API_KEY)
else:
    _client = None

PUBMED_ESEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
PUBMED_EFETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"

def retrieve_pubmed_sources(question: str, max_results: int = 5) -> list[dict]:
    pubmed_query = _rewrite_to_pubmed_query(question)
    pmids = _search_pubmed_ids(pubmed_query, retmax=max_results)
    articles = _fetch_pubmed_summaries(pmids)

    return [
        {
            "source_type": "pubmed",
            "title": a.get("title"),
            "content": a.get("abstract"),
            "score": 0.85,
            "url": a.get("url"),
            "pmid": a.get("pmid"),
            "journal": a.get("journal"),
            "year": a.get("year"),
        }
        for a in articles
    ]

def _clean_text(text: str) -> str:
    t = html.unescape(text or "")
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _rewrite_to_pubmed_query(user_question: str) -> str:
    q = (user_question or "").strip()
    if not q:
        return q

    if not _client:
        return q

    try:
        resp = _client.chat.completions.create(
            model=CHAT_MODEL,
            temperature=0.0,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a PubMed search query assistant. "
                        "Convert the user's medical question into a concise PubMed-friendly "
                        "English search query. Output query text only. No explanation."
                    ),
                },
                {"role": "user", "content": q},
            ],
        )
        out = (resp.choices[0].message.content or "").strip()
        return out or q
    except Exception:
        return q


def _search_pubmed_ids(query: str, retmax: int = 5) -> List[str]:
    params = {
        "db": "pubmed",
        "term": query,
        "retmax": max(1, min(int(retmax or 5), 8)),
        "retmode": "json",
        "sort": "relevance",
    }
    r = requests.get(PUBMED_ESEARCH_URL, params=params, timeout=25)
    r.raise_for_status()
    data = r.json()
    return data.get("esearchresult", {}).get("idlist", []) or []


def _fetch_pubmed_summaries(pmids: List[str]) -> List[Dict[str, Any]]:
    if not pmids:
        return []

    params = {
        "db": "pubmed",
        "id": ",".join(pmids),
        "retmode": "xml",
    }
    r = requests.get(PUBMED_EFETCH_URL, params=params, timeout=25)
    r.raise_for_status()

    root = ET.fromstring(r.text)
    articles: List[Dict[str, Any]] = []

    for article in root.findall(".//PubmedArticle"):
        pmid = _clean_text(article.findtext(".//PMID", default=""))
        title = _clean_text(article.findtext(".//ArticleTitle", default=""))
        journal = _clean_text(article.findtext(".//Journal/Title", default=""))
        year = _clean_text(article.findtext(".//PubDate/Year", default=""))

        abstract_nodes = article.findall(".//Abstract/AbstractText")
        abstract_parts = []
        for node in abstract_nodes:
            text = "".join(node.itertext())
            if text and text.strip():
                abstract_parts.append(_clean_text(text))
        abstract = " ".join(abstract_parts).strip()

        articles.append(
            {
                "pmid": pmid,
                "title": title,
                "journal": journal,
                "year": year,
                "abstract": abstract,
                "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else "",
            }
        )

    return articles


def _build_pubmed_context(articles: List[Dict[str, Any]]) -> str:
    blocks = []
    for i, a in enumerate(articles, start=1):
        blocks.append(
            "\n".join(
                [
                    f"[Paper {i}]",
                    f"PMID: {a.get('pmid', '')}",
                    f"Title: {a.get('title', '')}",
                    f"Journal: {a.get('journal', '')}",
                    f"Year: {a.get('year', '')}",
                    f"Abstract: {a.get('abstract', '')}",
                    f"URL: {a.get('url', '')}",
                ]
            )
        )
    return "\n\n".join(blocks)


def answer_with_pubmed(
    question: str,
    max_results: int = 5,
) -> Tuple[str, List[Dict[str, Any]]]:
    q = (question or "").strip()
    if not q:
        return "請先輸入問題。", []

    pubmed_query = _rewrite_to_pubmed_query(q)
    pmids = _search_pubmed_ids(pubmed_query, retmax=max_results)
    articles = _fetch_pubmed_summaries(pmids)

    sources = [
        {
            "title": a.get("title"),
            "page": None,
            "chunk": None,
            "score": None,
            "pmid": a.get("pmid"),
            "journal": a.get("journal"),
            "year": a.get("year"),
            "url": a.get("url"),
            "source_type": "pubmed",
        }
        for a in articles
    ]

    if not articles:
        return (
            "我有切到 PubMed 模式，但這次沒有查到合適文獻。"
            "建議把問題改成更明確的醫學關鍵字，例如部位、疾病、影像類型、方法。",
            sources,
        )

    if not _client:
        lines = [
            "（目前未設定 OPENAI_API_KEY，以下直接列出 PubMed 檢索結果）",
            "",
        ]
        for i, a in enumerate(articles, start=1):
            lines.append(f"{i}. {a.get('title')}")
            if a.get("journal") or a.get("year"):
                lines.append(f"   {a.get('journal', '')} {a.get('year', '')}".strip())
            if a.get("pmid"):
                lines.append(f"   PMID: {a.get('pmid')}")
            if a.get("url"):
                lines.append(f"   {a.get('url')}")
            if a.get("abstract"):
                lines.append(f"   摘要：{a.get('abstract')[:500]}")
            lines.append("")
        return "\n".join(lines).strip(), sources

    context = _build_pubmed_context(articles)

    system_prompt = (
        "你是一位醫學文獻助理。"
        "只能根據提供的 PubMed 文獻標題與摘要回答。"
        "不要捏造未出現的研究結果。"
        "如果證據有限，要明確說明。"
        "請用繁體中文，先給結論，再給重點整理，最後列出來源。"
    )

    user_prompt = (
        f"使用者問題：\n{q}\n\n"
        f"PubMed 檢索查詢式：\n{pubmed_query}\n\n"
        f"以下是 PubMed 檢索結果：\n{context}\n\n"
        "請根據以上內容回答，並在文末列出參考來源（標題 + PMID + URL）。"
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