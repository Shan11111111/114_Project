import os
from typing import List, Optional, Dict, Any
from uuid import uuid4

from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    PointStruct,
    Filter,
    FieldCondition,
    MatchValue,
)

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "bone_edu_docs")
VECTOR_SIZE = int(os.getenv("EMBEDDING_DIM", "1536"))


def is_gibberish(text: str) -> bool:
    if not text:
        return True
    t = text.strip()
    if len(t) < 20:
        return True
    bad = sum(1 for ch in t if ord(ch) < 32 or ch in "�˙ːʊ̊")
    ratio_bad = bad / max(len(t), 1)
    good = sum(1 for ch in t if ("\u4e00" <= ch <= "\u9fff") or ch.isalnum() or ch in "，。,.%()/- ")
    ratio_good = good / max(len(t), 1)
    return ratio_bad > 0.05 or ratio_good < 0.35


class VectorStore:
    def __init__(self) -> None:
        self.client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)

    def ensure_collection(self) -> None:
        names = [c.name for c in self.client.get_collections().collections]
        if QDRANT_COLLECTION not in names:
            self.client.create_collection(
                collection_name=QDRANT_COLLECTION,
                vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
            )

    def upsert_docs(self, docs: List[Dict[str, Any]]) -> None:
        if not docs:
            print("⚠️ upsert_docs skipped: docs is empty")
            return

        points: List[PointStruct] = []
        for d in docs:
            emb = d.get("embedding")
            if not emb:
                continue

            pid = d.get("id") or str(uuid4())
            payload = {
                "text": d.get("text", ""),
                "material_id": d.get("material_id"),
                "title": d.get("title"),
                "type": d.get("type") or d.get("source_type"),
                "language": d.get("language"),
                "style": d.get("style"),
                "file_path": d.get("file_path") or d.get("source_file"),
                "page": d.get("page"),
                "bone_id": d.get("bone_id"),
                "small_bone_id": d.get("small_bone_id") or d.get("bone_small_id"),
                "chunk_index": d.get("chunk_index"),
                "tags": d.get("tags") or [],
            }
            points.append(PointStruct(id=pid, vector=emb, payload=payload))

        if not points:
            print("⚠️ upsert_docs skipped: points is empty (all docs invalid/empty)")
            return

        self.client.upsert(collection_name=QDRANT_COLLECTION, points=points)

    def search(
    self,
    embedding: List[float],
    top_k: int = 5,
    bone_id: Optional[int] = None,
    small_bone_id: Optional[int] = None,
    bone_small_id: Optional[int] = None,  # ✅ alias 防呆
    score_threshold: float = 0.25,
):
        if small_bone_id is None and bone_small_id is not None:
            small_bone_id = bone_small_id

        must = []
        if bone_id is not None:
            must.append(FieldCondition(key="bone_id", match=MatchValue(value=bone_id)))
        if small_bone_id is not None:
            must.append(FieldCondition(key="small_bone_id", match=MatchValue(value=small_bone_id)))

        query_filter = Filter(must=must) if must else None

        # 取回 raw hits
        if hasattr(self.client, "search"):
            raw = self.client.search(
                collection_name=QDRANT_COLLECTION,
                query_vector=embedding,
                limit=top_k * 3,  # 多撈一些，才有空間過濾
                query_filter=query_filter,
                with_payload=True,
                with_vectors=False,
            )
        elif hasattr(self.client, "query_points"):
            resp = self.client.query_points(
                collection_name=QDRANT_COLLECTION,
                query=embedding,
                limit=top_k * 3,
                query_filter=query_filter,
                with_payload=True,
                with_vectors=False,
            )
            raw = getattr(resp, "points", resp)
        else:
            raise RuntimeError("Unsupported qdrant-client version: no search/query_points")

        # ✅ 過濾：分數太低 / 掃描占位 / 缺檔占位 / 明顯亂碼
        hits = []
        for p in raw:
            score = float(getattr(p, "score", 0) or 0)
            if score < score_threshold:
                continue

            payload = getattr(p, "payload", None) or {}
            text = (payload.get("text", "") or "").strip()

            if not text:
                continue
            if text.startswith("[SCANNED/NO-TEXT PDF]") or text.startswith("[MISSING FILE]"):
                continue
            if is_gibberish(text):
                continue

            hits.append(p)
            if len(hits) >= top_k:
                break

        return hits


    def query(
        self,
        query_text: str,
        embed_fn,
        top_k: int = 5,
        score_threshold: float = 0.32,
        bone_id: Optional[int] = None,
        small_bone_id: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        qvec = embed_fn(query_text)
        raw = self.search(qvec, top_k=top_k, bone_id=bone_id, small_bone_id=small_bone_id)

        hits: List[Dict[str, Any]] = []
        for p in raw:
            score = float(getattr(p, "score", 0) or 0)
            payload = getattr(p, "payload", None) or {}
            text = (payload.get("text") or "").strip()

            if score < score_threshold:
                continue
            if not text:
                continue
            if text.startswith("[SCANNED/NO-TEXT PDF]") or text.startswith("[MISSING FILE]"):
                continue
            if is_gibberish(text):
                continue

            hits.append({"score": score, "payload": payload})

        return hits
