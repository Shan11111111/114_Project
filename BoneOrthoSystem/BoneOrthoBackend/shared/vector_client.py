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

QDRANT_URL = os.getenv("QDRANT_URL", "http://127.0.0.1:6333")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "bone_edu_docs")
VECTOR_SIZE = int(os.getenv("EMBEDDING_DIM", "1536"))


def is_gibberish(text: str) -> bool:
    """
    用於排除掃描 PDF / 亂碼頁面。
    你可以依你們教材特性調整門檻。
    """
    if not text:
        return True
    t = text.strip()
    if len(t) < 20:
        return True

    # 常見亂碼符號 + 非可見字元
    bad = sum(1 for ch in t if ord(ch) < 32 or ch in "�˙ːʊ̊")
    ratio_bad = bad / max(len(t), 1)

    # 中文/英數/常見標點視為 good
    good = sum(
        1
        for ch in t
        if ("\u4e00" <= ch <= "\u9fff") or ch.isalnum() or ch in "，。,.%()/- \n\r\t：:、"
    )
    ratio_good = good / max(len(t), 1)

    return ratio_bad > 0.05 or ratio_good < 0.35


class VectorStore:
    def __init__(self) -> None:
        self.client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)

    # -----------------------------
    # Collection
    # -----------------------------
    def ensure_collection(self) -> None:
        names = [c.name for c in self.client.get_collections().collections]
        if QDRANT_COLLECTION not in names:
            self.client.create_collection(
                collection_name=QDRANT_COLLECTION,
                vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
            )

    def collection_info(self) -> Dict[str, Any]:
        info = self.client.get_collection(QDRANT_COLLECTION)
        # 回傳常用欄位（方便 debug）
        return {
            "name": QDRANT_COLLECTION,
            "points_count": getattr(info, "points_count", None),
            "indexed_vectors_count": getattr(info, "indexed_vectors_count", None),
            "status": getattr(info, "status", None),
        }

    # -----------------------------
    # Upsert
    # -----------------------------
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

    # -----------------------------
    # Search (return raw points)
    # -----------------------------
    def search(
        self,
        embedding: List[float],
        top_k: int = 5,
        bone_id: Optional[int] = None,
        small_bone_id: Optional[int] = None,
        bone_small_id: Optional[int] = None,  # alias 防呆
        score_threshold: float = 0.25,
        enable_gibberish_filter: bool = True,
        exclude_placeholders: bool = True,
    ) -> List[Any]:
        """
        回傳 Qdrant 原生 hit points（每個點有 .score / .payload）
        """
        if small_bone_id is None and bone_small_id is not None:
            small_bone_id = bone_small_id

        must: List[FieldCondition] = []
        if bone_id is not None:
            must.append(FieldCondition(key="bone_id", match=MatchValue(value=bone_id)))
        if small_bone_id is not None:
            must.append(FieldCondition(key="small_bone_id", match=MatchValue(value=small_bone_id)))

        query_filter = Filter(must=must) if must else None

        # 多撈一些，方便後面過濾
        limit = max(top_k * 3, top_k)

        # 兼容不同 qdrant-client
        if hasattr(self.client, "search"):
            raw = self.client.search(
                collection_name=QDRANT_COLLECTION,
                query_vector=embedding,
                limit=limit,
                query_filter=query_filter,
                with_payload=True,
                with_vectors=False,
            )
        elif hasattr(self.client, "query_points"):
            resp = self.client.query_points(
                collection_name=QDRANT_COLLECTION,
                query=embedding,
                limit=limit,
                query_filter=query_filter,
                with_payload=True,
                with_vectors=False,
            )
            raw = getattr(resp, "points", resp)
        else:
            raise RuntimeError("Unsupported qdrant-client version: no search/query_points")

        # 進行過濾
        hits: List[Any] = []
        for p in raw:
            score = float(getattr(p, "score", 0) or 0)
            if score < score_threshold:
                continue

            payload = getattr(p, "payload", None) or {}
            text = (payload.get("text", "") or "").strip()
            if not text:
                continue

            if exclude_placeholders:
                if text.startswith("[SCANNED/NO-TEXT PDF]") or text.startswith("[MISSING FILE]"):
                    continue

            if enable_gibberish_filter and is_gibberish(text):
                continue

            hits.append(p)
            if len(hits) >= top_k:
                break

        return hits

    # -----------------------------
    # Query (return simplified dicts)
    # -----------------------------
    def query(
        self,
        query_text: str,
        embed_fn,
        top_k: int = 5,
        score_threshold: float = 0.32,
        bone_id: Optional[int] = None,
        small_bone_id: Optional[int] = None,
        enable_gibberish_filter: bool = True,
    ) -> List[Dict[str, Any]]:
        """
        直接給文字 query → embedding → search → 回傳 dict list（方便 rag_tool 用）
        """
        qvec = embed_fn(query_text)
        raw = self.search(
            qvec,
            top_k=top_k,
            bone_id=bone_id,
            small_bone_id=small_bone_id,
            score_threshold=score_threshold,
            enable_gibberish_filter=enable_gibberish_filter,
        )

        hits: List[Dict[str, Any]] = []
        for p in raw:
            score = float(getattr(p, "score", 0) or 0)
            payload = getattr(p, "payload", None) or {}
            hits.append({"score": score, "payload": payload})

        return hits
