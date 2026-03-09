from __future__ import annotations

from pathlib import Path
from typing import Tuple, List, Dict, Any, Optional
import re
import os
import json
import hashlib
from urllib.parse import urlparse
from datetime import datetime


# =========================================================
# 你原本的 doc_tool.py（✅ 保留核心行為：clean / summary / extract_* / extract_text_and_summary）
# 另外合併：doc_index（本地 jsonl 索引/檢索）+ URL 抓取與索引
# =========================================================

# -------------------------
# Text helpers
# -------------------------
def _clean_text(t: str) -> str:
    t = (t or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = []
    for line in t.split("\n"):
        line = re.sub(r"[ \t]+", " ", line).strip()
        if line:
            lines.append(line)
    return "\n".join(lines).strip()


def _drop_boilerplate_lines(lines: List[str]) -> List[str]:
    """
    針對網頁抽字後常見雜訊做基本過濾（保守，不要誤刪太多）
    """
    bad_phrases = [
        "熱門文章", "熱門話題", "分類", "標籤", "延伸閱讀",
        "按讚", "分享", "回到首頁", "上一頁", "下一頁",
        "訂閱", "登入", "註冊", "會員", "廣告", "cookie",
    ]
    out = []
    for ln in lines:
        s = ln.strip()
        if not s:
            continue
        # 太短、像導航
        if len(s) <= 2:
            continue
        if any(p in s for p in bad_phrases):
            # 但如果是「注意/警訊/就醫」這種關鍵字就留
            if any(k in s for k in ["注意", "警訊", "就醫", "回診", "禁忌", "不可", "避免"]):
                out.append(s)
            continue
        out.append(s)
    return out


def _make_summary(t: str, max_chars: int = 1200) -> str:
    """
    產出「像摘要」的條列重點：
    - 先抓最常見的關鍵句（含：注意事項/適應症/步驟/警訊/何時就醫/禁忌）
    - 不夠再補前段內容
    """
    t = _clean_text(t)
    if not t:
        return ""

    lines = [ln.strip() for ln in t.split("\n") if ln.strip()]
    if not lines:
        return ""

    # 網頁雜訊先砍一波
    lines = _drop_boilerplate_lines(lines)

    keywords = [
        "注意", "警訊", "何時", "就醫", "回診", "傷口", "換藥", "浸泡",
        "消毒", "感染", "紅", "腫", "熱", "痛", "流膿", "發燒",
        "步驟", "方法", "需", "請", "避免", "不可", "禁忌",
        "目的", "適應", "適用", "處置", "藥", "敷料",
        "風險", "症狀", "治療", "預防", "檢查",
    ]

    picked = []
    seen = set()

    def add(line: str):
        s = line.strip()
        if not s:
            return
        if s in seen:
            return
        seen.add(s)
        picked.append(s)

    # 1) 先抓含關鍵詞的句子
    for ln in lines:
        if any(k in ln for k in keywords):
            add(ln)
        if len(picked) >= 10:
            break

    # 2) 不足的話，補前面幾行有資訊密度的
    if len(picked) < 6:
        for ln in lines[:30]:
            if any(x in ln for x in ["編號", "核可", "製作單位", "科別", "copyright"]):
                continue
            add(ln)
            if len(picked) >= 8:
                break

    out = []
    total = 0
    for ln in picked:
        item = f"- {ln}"
        if total + len(item) > max_chars:
            break
        out.append(item)
        total += len(item)

    return "\n".join(out).strip()


# -------------------------
# Extractors
# -------------------------
def _extract_pdf(path: Path) -> str:
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(str(path))
        texts = []
        for page in doc:
            texts.append(page.get_text("text") or "")
        doc.close()
        return "\n".join(texts)
    except Exception:
        pass

    try:
        import pdfplumber
        texts = []
        with pdfplumber.open(str(path)) as pdf:
            for p in pdf.pages:
                texts.append(p.extract_text() or "")
        return "\n".join(texts)
    except Exception:
        pass

    try:
        from pypdf import PdfReader
        r = PdfReader(str(path))
        texts = []
        for p in r.pages:
            texts.append(p.extract_text() or "")
        return "\n".join(texts)
    except Exception as e:
        raise RuntimeError(f"PDF 解析器不可用或解析失敗：{e}")


def _extract_txt_like(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def _extract_docx(path: Path) -> str:
    try:
        import docx  # python-docx
        d = docx.Document(str(path))
        return "\n".join([p.text for p in d.paragraphs])
    except Exception as e:
        raise RuntimeError(f"DOCX 解析失敗：{e}")


def _extract_pptx(path: Path) -> str:
    try:
        from pptx import Presentation
        prs = Presentation(str(path))
        texts = []
        for slide in prs.slides:
            for shape in slide.shapes:
                if hasattr(shape, "text"):
                    texts.append(shape.text or "")
        return "\n".join(texts)
    except Exception as e:
        raise RuntimeError(f"PPTX 解析失敗：{e}")


def _extract_xlsx(path: Path) -> str:
    try:
        import openpyxl
        wb = openpyxl.load_workbook(str(path), data_only=True)
        texts = []
        for ws in wb.worksheets:
            texts.append(f"[Sheet] {ws.title}")
            for row in ws.iter_rows(values_only=True):
                line = " ".join([str(x) for x in row if x is not None]).strip()
                if line:
                    texts.append(line)
        return "\n".join(texts)
    except Exception as e:
        raise RuntimeError(f"XLSX 解析失敗：{e}")


def _strip_html(html: str) -> str:
    s = html or ""
    s = re.sub(r"(?is)<(script|style|noscript|svg|canvas|iframe).*?>.*?</\1>", " ", s)
    s = re.sub(r"(?is)<!--.*?-->", " ", s)
    s = re.sub(r"(?is)<br\s*/?>", "\n", s)
    s = re.sub(r"(?is)</p\s*>", "\n", s)
    s = re.sub(r"(?is)</div\s*>", "\n", s)
    s = re.sub(r"(?is)<[^>]+>", " ", s)
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def _extract_html_like(path: Path) -> str:
    raw = path.read_text(encoding="utf-8", errors="ignore")
    return _strip_html(raw)


def _extract_md(path: Path) -> str:
    raw = path.read_text(encoding="utf-8", errors="ignore")
    raw = re.sub(r"```.*?```", " ", raw, flags=re.S)
    raw = re.sub(r"`([^`]+)`", r"\1", raw)
    raw = re.sub(r"!\[[^\]]*\]\([^)]+\)", " ", raw)
    raw = re.sub(r"\[[^\]]+\]\([^)]+\)", " ", raw)
    raw = re.sub(r"^#{1,6}\s*", "", raw, flags=re.M)
    return raw


# -------------------------
# Public API (原本的)
# -------------------------
def extract_text_and_summary(file_path: Path, ext: str) -> Tuple[str, str]:
    p = Path(file_path)
    e = (ext or "").lower().lstrip(".")

    if not p.exists():
        raise RuntimeError(f"檔案不存在：{p}")

    if e == "pdf":
        text = _extract_pdf(p)
    elif e in ("txt", "csv"):
        text = _extract_txt_like(p)
    elif e in ("doc", "docx"):
        if e == "doc":
            raise RuntimeError("不支援 .doc（請轉成 .docx）")
        text = _extract_docx(p)
    elif e in ("ppt", "pptx"):
        if e == "ppt":
            raise RuntimeError("不支援 .ppt（請轉成 .pptx）")
        text = _extract_pptx(p)
    elif e in ("xls", "xlsx"):
        if e == "xls":
            raise RuntimeError("不支援 .xls（請轉成 .xlsx）")
        text = _extract_xlsx(p)
    elif e in ("html", "htm"):
        text = _extract_html_like(p)
    elif e in ("md", "markdown"):
        text = _extract_md(p)
    else:
        raise RuntimeError(f"不支援的檔案格式：.{e}")

    text = _clean_text(text)
    if not text:
        raise RuntimeError("抽不到文字：可能是掃描 PDF（沒有文字層），或檔案內容不可抽取。")

    summary = _make_summary(text)
    return text, summary


# =========================================================
# ✅ Doc-RAG：本地索引/檢索（jsonl）
#   - 開關：S2_ENABLE_DOC_RAG=1
# =========================================================
TOOLS_DIR = Path(__file__).resolve().parent
INDEX_DIR = TOOLS_DIR / "_doc_index"
INDEX_DIR.mkdir(parents=True, exist_ok=True)
INDEX_PATH = INDEX_DIR / "doc_store.jsonl"


def is_enabled() -> bool:
    return os.getenv("S2_ENABLE_DOC_RAG", "0") == "1"


def _tokenize(s: str) -> List[str]:
    s = (s or "").lower()
    parts = re.findall(r"[\u4e00-\u9fff]|[a-z0-9]+", s)
    return [p for p in parts if p and p.strip()]


def _overlap_score(q_tokens: List[str], d_tokens: List[str]) -> float:
    if not q_tokens or not d_tokens:
        return 0.0
    qs = set(q_tokens)
    ds = set(d_tokens)
    inter = len(qs & ds)
    denom = (len(qs) ** 0.7) * (len(ds) ** 0.3)
    return float(inter) / float(denom or 1.0)


def _split_paragraphs(text: str) -> List[str]:
    t = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    paras = re.split(r"\n\s*\n", t)
    out = []
    for p in paras:
        p = _clean_text(p)
        if p:
            out.append(p)
    return out


def _chunk_text(text: str, max_chars: int = 900) -> List[str]:
    paras = _split_paragraphs(text)
    chunks: List[str] = []
    buf = ""
    for p in paras:
        if not buf:
            buf = p
            continue
        if len(buf) + 1 + len(p) <= max_chars:
            buf = buf + "\n" + p
        else:
            chunks.append(buf)
            buf = p
    if buf:
        chunks.append(buf)
    return chunks


def _append_jsonl(path: Path, rows: List[Dict[str, Any]]) -> None:
    if not rows:
        return
    with open(path, "a", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def _read_all_jsonl(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    out = []
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except Exception:
                continue
    return out


def index_document(
    text: str,
    title: str,
    source_type: str,
    material_id: str,
    *,
    url: Optional[str] = None,
    conversation_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> int:
    if not text:
        return 0
    chunks = _chunk_text(text, max_chars=int(os.getenv("S2_DOC_CHUNK_CHARS", "900")))
    rows = []
    now = datetime.utcnow().isoformat()

    for i, ch in enumerate(chunks):
        rows.append(
            {
                "material_id": str(material_id),
                "title": title,
                "source_type": source_type,
                "chunk_index": i,
                "text": ch,
                "tokens": _tokenize(ch),
                "url": url,
                "conversation_id": conversation_id,
                "user_id": user_id,
                "created_at": now,
            }
        )

    _append_jsonl(INDEX_PATH, rows)
    return len(rows)


def retrieve(query: str, top_k: int = 6) -> List[Dict[str, Any]]:
    q = (query or "").strip()
    if not q:
        return []
    q_tokens = _tokenize(q)
    docs = _read_all_jsonl(INDEX_PATH)

    scored: List[Dict[str, Any]] = []
    for d in docs:
        d_tokens = d.get("tokens") or []
        s = _overlap_score(q_tokens, d_tokens)
        if s <= 0:
            continue
        scored.append(
            {
                "material_id": d.get("material_id"),
                "title": d.get("title"),
                "source_type": d.get("source_type"),
                "chunk_index": d.get("chunk_index"),
                "text": d.get("text"),
                "score": float(s),
                "url": d.get("url"),
            }
        )

    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[: max(1, int(top_k))]


# =========================================================
# ✅ URL 抓取 + 索引（貼 URL 就能解析）
#   - 403 / 斷線：不要讓外層爆炸（index_url 不丟例外）
#   - 加 headers + retry + jina.ai fallback
# =========================================================
_URL_RE = re.compile(r"https?://\S+")


def extract_first_url(text: str) -> Optional[str]:
    m = _URL_RE.search(text or "")
    if not m:
        return None
    return m.group(0).strip().rstrip(").,]}>\"'")


def _guess_title_from_html(html: str) -> str:
    m = re.search(r"(?is)<title[^>]*>(.*?)</title>", html or "")
    if not m:
        return ""
    t = re.sub(r"\s+", " ", m.group(1)).strip()
    return t[:120]


def _download_url(url: str) -> Tuple[str, str, str]:
    """
    return: (body_text, final_url, content_type)
    """
    try:
        import httpx
    except Exception as e:
        raise RuntimeError(f"httpx 未安裝：{e}")

    headers = {
        "User-Agent": os.getenv(
            "S2_URL_UA",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.7",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Connection": "close",
    }

    timeout = float(os.getenv("S2_URL_TIMEOUT", "12"))
    max_bytes = int(os.getenv("S2_URL_MAX_BYTES", "2500000"))  # 2.5MB

    last_err = None
    for _ in range(2):  # retry
        try:
            with httpx.Client(
                follow_redirects=True,
                timeout=timeout,
                headers=headers,
                http2=False,
            ) as client:
                r = client.get(url)
                ct = (r.headers.get("content-type") or "").lower()
                if r.status_code >= 400:
                    raise RuntimeError(f"Client error '{r.status_code}' for url '{str(r.url)}'")
                text = r.text
                if len(text.encode("utf-8", errors="ignore")) > max_bytes:
                    text = text[: max_bytes // 2]  # 粗暴截斷，避免爆記憶體/延遲
                return text, str(r.url), ct
        except Exception as e:
            last_err = e
            continue

    raise RuntimeError(str(last_err))


def _download_url_via_jina(url: str) -> Tuple[str, str, str]:
    """
    fallback：把 https://xxx 變成 https://r.jina.ai/https://xxx
    403 有時會被救起來（非保證；付費牆/強反爬仍可能失敗）
    """
    try:
        import httpx
    except Exception as e:
        raise RuntimeError(f"httpx 未安裝：{e}")

    u = url.strip()
    if u.startswith("https://"):
        proxy = "https://r.jina.ai/https://" + u[len("https://") :]
    elif u.startswith("http://"):
        proxy = "https://r.jina.ai/http://" + u[len("http://") :]
    else:
        proxy = "https://r.jina.ai/http://" + u

    timeout = float(os.getenv("S2_URL_TIMEOUT", "12"))
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/plain,*/*",
        "Connection": "close",
    }
    with httpx.Client(follow_redirects=True, timeout=timeout, headers=headers, http2=False) as client:
        r = client.get(proxy)
        if r.status_code >= 400:
            raise RuntimeError(f"Proxy error '{r.status_code}' for url '{proxy}'")
        text = r.text
        return text, url, "text/plain"


def extract_url_text_and_summary(url: str) -> Tuple[str, str, str, str]:
    """
    return: (text, summary, title, final_url)
    """
    body = ""
    final_url = url
    ct = ""
    last_err = None

    try:
        body, final_url, ct = _download_url(url)
    except Exception as e:
        last_err = e

    if not body:
        try:
            body, final_url, ct = _download_url_via_jina(url)
            last_err = None
        except Exception as e:
            last_err = e

    if not body:
        raise RuntimeError(f"下載網址失敗：{last_err}")

    title = ""
    if "text/html" in ct or "<html" in body.lower():
        title = _guess_title_from_html(body)
        text = _strip_html(body)
    else:
        text = body

    text = _clean_text(text)
    if not text:
        raise RuntimeError("抽不到文字：該網址可能是純圖片/需登入/或拒絕存取。")

    # 再做一輪雜訊過濾（避免摘要全是導覽）
    lines = _drop_boilerplate_lines([ln for ln in text.split("\n") if ln.strip()])
    text = "\n".join(lines).strip()

    summary = _make_summary(text)
    if not title:
        try:
            host = urlparse(final_url).netloc
            title = host or "web"
        except Exception:
            title = "web"

    return text, summary, title, final_url


def index_url(
    url: str,
    conversation_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    ✅ 最重要：這個函式「不要把錯丟出去」
    成功/失敗都回 dict，讓 main.py 能把結果塞進 (1) 直接回答前面的 context
    """
    url = (url or "").strip()
    if not url:
        return {"ok": False, "url": url, "warning": "empty url"}

    try:
        text, summary, title, final_url = extract_url_text_and_summary(url)

        mid = hashlib.sha1(final_url.encode("utf-8")).hexdigest()
        indexed = index_document(
            text=text,
            title=title,
            source_type="url",
            material_id=mid,
            url=final_url,
            conversation_id=conversation_id,
            user_id=user_id,
        )

        return {
            "ok": True,
            "material_id": mid,
            "title": title,
            "summary": summary,
            "text": text,
            "url": final_url,
            "indexed_chunks": indexed,
        }
    except Exception as e:
        return {
            "ok": False,
            "url": url,
            "warning": f"{e}",
            "material_id": hashlib.sha1(url.encode('utf-8')).hexdigest(),
        }


def build_url_digest(idx: Dict[str, Any]) -> str:
    """
    給 main.py / rag prompt 用：
    讓「已解析網址/摘要」能放到 (1) 直接回答之前
    """
    if not idx:
        return ""

    ok = bool(idx.get("ok"))
    url = idx.get("url") or ""
    title = idx.get("title") or ""
    summary = (idx.get("summary") or "").strip()
    warning = (idx.get("warning") or "").strip()

    if ok:
        head = f"【已解析網址】{url}"
        if title:
            head += f"\n【標題】{title}"
        if summary:
            return f"{head}\n【摘要】\n{summary}".strip()
        return f"{head}\n【摘要】（抽取成功，但摘要為空）".strip()

    # 失敗：也要回一段可以讓模型/使用者理解的文字，不要直接消失
    head = f"【已解析網址】{url}"
    if warning:
        return f"{head}\n【解析失敗】{warning}".strip()
    return f"{head}\n【解析失敗】未知錯誤".strip()
