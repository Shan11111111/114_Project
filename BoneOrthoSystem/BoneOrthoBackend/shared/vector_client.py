# shared/vector_client.py
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


class VectorStore:
    def __init__(self) -> None:
        self.client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)

    def ensure_collection(self) -> None:
        collections = self.client.get_collections().collections
        names = [c.name for c in collections]
        if QDRANT_COLLECTION not in names:
            self.client.recreate_collection(
                collection_name=QDRANT_COLLECTION,
                vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
            )

    def upsert_docs(self, docs: List[Dict[str, Any]]) -> None:
        # 0) 防呆：空就不要打 Qdrant（會 400 Empty update request）
        if not docs:
            print("⚠️ upsert_docs skipped: docs is empty")
            return

        points: List[PointStruct] = []

        for d in docs:
            # 1) 防呆：embedding 必須存在且非空
            emb = d.get("embedding")
            if not emb:
                continue

            pid = d.get("id") or str(uuid4())

            # 2) payload 統一欄位（新舊相容）
            payload = {
                "text": d.get("text", ""),
                "material_id": d.get("material_id"),
                "title": d.get("title"),

                # ✅ 新欄位（你的 rag/service 會讀）
                "type": d.get("type") or d.get("source_type"),
                "language": d.get("language"),
                "style": d.get("style"),
                "file_path": d.get("file_path") or d.get("source_file"),

                "page": d.get("page"),
                "bone_id": d.get("bone_id"),
                "small_bone_id": d.get("small_bone_id") or d.get("bone_small_id"),
                "tags": d.get("tags") or [],

                # ✅ 舊欄位也保留（相容以前資料）
                "source_type": d.get("source_type") or d.get("type"),
                "source_file": d.get("source_file") or d.get("file_path"),
            }

            points.append(PointStruct(id=pid, vector=emb, payload=payload))

        # 3) 防呆：全部都被 skip 掉就不要 upsert
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
    ):
        # alias：讓外面丟 bone_small_id 也能用
        if small_bone_id is None and bone_small_id is not None:
            small_bone_id = bone_small_id

        must = []
        if bone_id is not None:
            must.append(FieldCondition(key="bone_id", match=MatchValue(value=bone_id)))
        if small_bone_id is not None:
            must.append(FieldCondition(key="small_bone_id", match=MatchValue(value=small_bone_id)))

        query_filter = Filter(must=must) if must else None

        # ✅ 相容不同版本 qdrant-client：search 或 query_points
        if hasattr(self.client, "search"):
            return self.client.search(
                collection_name=QDRANT_COLLECTION,
                query_vector=embedding,
                limit=top_k,
                query_filter=query_filter,
                with_payload=True,
                with_vectors=False,
            )

        if hasattr(self.client, "query_points"):
            resp = self.client.query_points(
                collection_name=QDRANT_COLLECTION,
                query=embedding,
                limit=top_k,
                query_filter=query_filter,
                with_payload=True,
                with_vectors=False,
            )
            return getattr(resp, "points", resp)

        raise RuntimeError("Unsupported qdrant-client version: no search/query_points")
