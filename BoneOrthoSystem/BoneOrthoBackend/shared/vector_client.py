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
        self.client = QdrantClient(
            url=QDRANT_URL,
            api_key=QDRANT_API_KEY,
        )

    def ensure_collection(self) -> None:
        """如果 collection 不存在就建一個。"""
        collections = self.client.get_collections().collections
        names = [c.name for c in collections]
        if QDRANT_COLLECTION not in names:
            self.client.recreate_collection(
                collection_name=QDRANT_COLLECTION,
                vectors_config=VectorParams(
                    size=VECTOR_SIZE,
                    distance=Distance.COSINE,
                ),
            )

    def upsert_docs(self, docs: List[Dict[str, Any]]) -> None:
        """
        docs 需要有：
        {
          "embedding": List[float],
          "text": str,
          "title": str | None,
          "source_type": str | None,
          "source_file": str | None,
          "page": int | None,
          "bone_id": int | None,
          "small_bone_id": int | None,
          "tags": List[str] | None,
          "id": str (optional),
        }
        """
        points: List[PointStruct] = []
        for d in docs:
            pid = d.get("id") or str(uuid4())
            payload = {
                "text": d.get("text", ""),
                "title": d.get("title"),
                "source_type": d.get("source_type"),
                "source_file": d.get("source_file"),
                "page": d.get("page"),
                "bone_id": d.get("bone_id"),
                "small_bone_id": d.get("small_bone_id"),
                "tags": d.get("tags") or [],
            }
            points.append(
                PointStruct(
                    id=pid,
                    vector=d["embedding"],
                    payload=payload,
                )
            )

        self.client.upsert(
            collection_name=QDRANT_COLLECTION,
            points=points,
        )

    def search(
        self,
        embedding: List[float],
        top_k: int = 5,
        bone_id: Optional[int] = None,
        small_bone_id: Optional[int] = None,
    ):
        must = []
        if bone_id is not None:
            must.append(FieldCondition(key="bone_id", match=MatchValue(value=bone_id)))
        if small_bone_id is not None:
            must.append(FieldCondition(key="small_bone_id", match=MatchValue(value=small_bone_id)))

        query_filter = Filter(must=must) if must else None

        result = self.client.search(
            collection_name=QDRANT_COLLECTION,
            query_vector=embedding,
            limit=top_k,
            query_filter=query_filter,
        )
        return result
