from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import List, Dict, Any, Optional

from dotenv import load_dotenv
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct
from openai import OpenAI


def _load_env():
    # 盡量找 BoneOrthoBackend/.env
    here = Path(__file__).resolve()
    candidates = [
        here.parents[1] / ".env",  # BoneOrthoBackend/.env
        here.parents[2] / ".env",
    ]
    for p in candidates:
        if p.exists():
            load_dotenv(p)
            return


def _embed(oc: OpenAI, text: str, model: str, dim: int) -> List[float]:
    vec = oc.embeddings.create(model=model, input=text).data[0].embedding
    if len(vec) != dim:
        raise RuntimeError(f"embedding dim mismatch: got {len(vec)} expected {dim}")
    return vec


def _pdf_pages_text(pdf_path: Path) -> List[Dict[str, Any]]:
    # 優先 PyMuPDF (fitz)
    try:
        import fitz  # pip install pymupdf
        doc = fitz.open(str(pdf_path))
        out = []
        for i in range(doc.page_count):
            txt = doc.load_page(i).get_text("text").strip()
            if txt:
                out.append({"text": txt, "page": i + 1})
        doc.close()
        return out
    except Exception as e:
        # 失敗就回空，讓上層做 fallback
        print(f"⚠️ PyMuPDF failed on {pdf_path.name}: {e}")
        return []


def _chunk_text(text: str, max_chars: int = 1500) -> List[str]:
    text = text.replace("\r\n", "\n").strip()
    if not text:
        return []
    return [text[i:i + max_chars] for i in range(0, len(text), max_chars)]


def main():
    _load_env()

    qdrant_url = os.getenv("QDRANT_URL", "http://127.0.0.1:6333")
    collection = os.getenv("QDRANT_COLLECTION", "bone_edu_docs")
    embedding_model = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")  # 1536
    vector_size = int(os.getenv("VECTOR_SIZE", "1536"))

    # ✅ 你的資料夾：BoneOrthoBackend\s2_agent\vectordb\materials
    materials_dir = os.getenv("MATERIALS_DIR", "").strip()
    if not materials_dir:
        raise SystemExit("❌ MATERIALS_DIR 未設定（指向 s2_agent\\vectordb\\materials）")

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("❌ OPENAI_API_KEY 未設定，無法產生 embeddings")

    client = QdrantClient(url=qdrant_url)
    oc = OpenAI(api_key=api_key)

    # ensure collection
    cols = [c.name for c in client.get_collections().collections]
    if collection not in cols:
        client.create_collection(
            collection_name=collection,
            vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
        )

    root = Path(materials_dir)
    if not root.exists():
        raise SystemExit(f"❌ MATERIALS_DIR 不存在：{root}")

    batch: List[PointStruct] = []
    total = 0

    for fp in root.rglob("*"):
        if not fp.is_file():
            continue

        suffix = fp.suffix.lower()
        title = fp.stem

        if suffix in (".txt", ".md"):
            raw = fp.read_text(encoding="utf-8", errors="ignore")
            pages = [{"text": raw, "page": None}]
        elif suffix == ".pdf":
            pages = _pdf_pages_text(fp)
            if not pages:
                # 掃描 PDF / 無文字
                pages = [{"text": f"[NO_TEXT_PDF] {fp.name}", "page": None}]
        else:
            continue

        for pi, page_obj in enumerate(pages):
            for ci, ch in enumerate(_chunk_text(page_obj["text"])):
                vec = _embed(oc, ch, embedding_model, vector_size)
                batch.append(
                    PointStruct(
                        id=str(uuid.uuid4()),
                        vector=vec,
                        payload={
                            "text": ch,
                            "title": title,
                            "file_path": str(fp),
                            "page": page_obj.get("page"),
                            "chunk_index": ci,
                        },
                    )
                )
                total += 1

                if len(batch) >= 64:
                    client.upsert(collection_name=collection, points=batch)
                    batch.clear()

    if batch:
        client.upsert(collection_name=collection, points=batch)

    info = client.get_collection(collection)
    print(f"✅ Done. total_chunks={total}, points_count={info.points_count}")


if __name__ == "__main__":
    main()
