from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

import os
from qdrant_client import QdrantClient

# ✅ 直接用 OpenAI 產 embedding（避免 import s2_agent -> reportlab 地雷）
from openai import OpenAI

QDRANT_URL = os.getenv("QDRANT_URL", "http://127.0.0.1:6333")
COLLECTION = os.getenv("QDRANT_COLLECTION", "bone_edu_docs")

# 你現在 collection 是 1536 Cosine，所以用 text-embedding-3-small 最對
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
VECTOR_SIZE = int(os.getenv("VECTOR_SIZE", "1536"))

def embed_text_local(text: str) -> list[float]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")
    oc = OpenAI(api_key=api_key)
    vec = oc.embeddings.create(model=EMBEDDING_MODEL, input=text).data[0].embedding
    if len(vec) != VECTOR_SIZE:
        raise RuntimeError(f"embedding dim mismatch: got {len(vec)} expected {VECTOR_SIZE}")
    return vec

def main():
    print("QDRANT_URL =", QDRANT_URL)
    print("COLLECTION =", COLLECTION)
    print("EMBEDDING_MODEL =", EMBEDDING_MODEL)

    client = QdrantClient(url=QDRANT_URL)

    # 先確認 collection 狀態
    try:
        info = client.get_collection(COLLECTION)
        points = getattr(info, "points_count", None)
        indexed = getattr(info, "indexed_vectors_count", None)
        print(f"COLLECTION points_count={points}, indexed_vectors_count={indexed}")
    except Exception as e:
        print("❌ get_collection failed:", e)
        return

    q = input("query> ").strip()
    if not q:
        print("empty query")
        return

    qvec = embed_text_local(q)

    # 你原本用 query_points OK
    res = client.query_points(
        collection_name=COLLECTION,
        query=qvec,
        limit=5,
        with_payload=True,
    )

    hits = getattr(res, "points", []) or []
    print(f"\nRAW_HITS={len(hits)}")

    for i, h in enumerate(hits, 1):
        payload = h.payload or {}
        print(f"\n#{i} score={getattr(h, 'score', None)}")
        print("title:", payload.get("title"))
        print("material_id:", payload.get("material_id"))
        print("page:", payload.get("page"))
        text = payload.get("text", "") or ""
        print("text:", (text[:200] + "..." if len(text) > 200 else text))

if __name__ == "__main__":
    main()
