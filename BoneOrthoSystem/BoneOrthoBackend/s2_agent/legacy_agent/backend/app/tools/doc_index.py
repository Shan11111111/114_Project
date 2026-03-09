#把抽到的文字切 chunk、索引、檢索
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Tuple


# =========================================================
# Config
# =========================================================
BASE_DIR = Path(__file__).resolve().parent
INDEX_DIR = BASE_DIR / "_doc_index"
INDEX_DIR.mkdir(parents=True, exist_ok=True)

INDEX_PATH = INDEX_DIR / "index.jsonl"

DEFAULT_CHUNK_CHARS = int(os.getenv("S2_DOC_CHUNK_CHARS", "900"))
DEFAULT_CHUNK_OVERLAP = int(os.getenv("S2_DOC_CHUNK_OVERLAP", "120"))

# 開關（你前面已在 .env 用過）
def is_enabled() -> bool:
    return os.getenv("S2_ENABLE_DOC_RAG", "0") == "1"


# =========================================================
# Tokenize / scoring
# =========================================================
_WORD_RE = re.compile(r"[A-Za-z0-9_]+|[\u4e00-\u9fff]+")

def _tokenize(s: str) -> List[str]:
    s = (s or "").lower()
    tokens = _WORD_RE.findall(s)
    # 把純中文長串拆成 2-gram，讓「關鍵字」更容易對上
    out: List[str] = []
    for t in tokens:
        if re.fullmatch(r"[\u4e00-\u9fff]+", t) and len(t) >= 3:
            # 2-gram
            for i in range(len(t) - 1):
                out.append(t[i:i+2])
        else:
            out.append(t)
    return out

def _overlap_score(q_tokens: List[str], d_tokens: List[str]) -> float:
    if not q_tokens or not d_tokens:
        return 0.0
    q = {}
    for t in q_tokens:
        q[t] = q.get(t, 0) + 1
    d = {}
    for t in d_tokens:
        d[t] = d.get(t, 0) + 1
    # weighted overlap
    score = 0.0
    for t, c in q.items():
        if t in d:
            score += min(c, d[t])
    # normalize
    return score / (len(q_tokens) ** 0.5)


# =========================================================
# Chunking
# =========================================================
def _clean_text(t: str) -> str:
    t = (t or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = []
    for ln in t.split("\n"):
        ln = re.sub(r"[ \t]+", " ", ln).strip()
        if ln:
            lines.append(ln)
    return "\n".join(lines).strip()

def _split_paragraphs(t: str) -> List[str]:
    t = _clean_text(t)
    if not t:
        return []
    paras = re.split(r"\n{2,}", t)
    return [p.strip() for p in paras if p.strip()]

def _chunk_text(text: str, chunk_chars: int, overlap: int) -> List[str]:
    paras = _split_paragraphs(text)
    if not paras:
        return []

    chunks: List[str] = []
    buf = ""
    for p in paras:
        if not buf:
            buf = p
        elif len(buf) + 2 + len(p) <= chunk_chars:
            buf = buf + "\n\n" + p
        else:
            chunks.append(buf)
            # overlap：取尾巴一小段接下一塊（避免斷句）
            tail = buf[-overlap:] if overlap > 0 else ""
            buf = (tail + "\n\n" + p).strip()
    if buf:
        chunks.append(buf)
    return chunks


# =========================================================
# IO
# =========================================================
def _append_jsonl(path: Path, obj: Dict[str, Any]) -> None:
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")

def _read_all_jsonl(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    rows: List[Dict[str, Any]] = []
    with open(path, "r", encoding="utf-8") as f:
        for ln in f:
            ln = ln.strip()
            if not ln:
                continue
            try:
                rows.append(json.loads(ln))
            except Exception:
                continue
    return rows


# =========================================================
# Public API
# =========================================================
def index_document(
    material_id: str,
    title: str,
    source_type: str,
    text: str,
    meta: Dict[str, Any] | None = None,
    chunk_chars: int | None = None,
    overlap: int | None = None,
) -> Dict[str, Any]:
    """
    把整份文件切 chunks 後寫入 index.jsonl
    """
    material_id = (material_id or "").strip()
    if not material_id:
        raise ValueError("material_id is required")

    title = (title or material_id).strip()
    source_type = (source_type or "unknown").strip()
    meta = meta or {}

    cc = int(chunk_chars or DEFAULT_CHUNK_CHARS)
    ov = int(overlap or DEFAULT_CHUNK_OVERLAP)

    clean = _clean_text(text)
    if not clean:
        raise ValueError("empty text")

    chunks = _chunk_text(clean, cc, ov)

    for i, ch in enumerate(chunks):
        row = {
            "material_id": material_id,
            "title": title,
            "source_type": source_type,
            "chunk_index": i,
            "text": ch,
            "meta": meta,
        }
        _append_jsonl(INDEX_PATH, row)

    return {"indexed": True, "material_id": material_id, "chunks": len(chunks), "index_path": str(INDEX_PATH)}


def retrieve(query: str, top_k: int = 6) -> List[Dict[str, Any]]:
    """
    簡易 keyword overlap 檢索
    回傳：[{material_id,title,source_type,chunk_index,text,score,meta}]
    """
    q = (query or "").strip()
    if not q:
        return []

    rows = _read_all_jsonl(INDEX_PATH)
    if not rows:
        return []

    q_tokens = _tokenize(q)
    scored: List[Tuple[float, Dict[str, Any]]] = []
    for r in rows:
        text = (r.get("text") or "")
        d_tokens = _tokenize(text)
        s = _overlap_score(q_tokens, d_tokens)
        if s <= 0:
            continue
        rr = dict(r)
        rr["score"] = float(s)
        scored.append((s, rr))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [x[1] for x in scored[: max(1, int(top_k))]]
