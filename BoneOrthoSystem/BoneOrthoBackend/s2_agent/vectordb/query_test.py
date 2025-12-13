from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

import os
from qdrant_client import QdrantClient

from s2_agent.service import embed_text

QDRANT_URL = os.getenv("QDRANT_URL", "http://127.0.0.1:6333")
COLLECTION = os.getenv("QDRANT_COLLECTION", "bone_edu_docs")

def main():
    print("QDRANT_URL =", QDRANT_URL)
    print("COLLECTION =", COLLECTION)

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

    qvec = embed_text(q)

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
