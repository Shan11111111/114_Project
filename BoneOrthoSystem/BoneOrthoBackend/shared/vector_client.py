import os
import json
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
    PayloadSchemaType,
)

QDRANT_URL = os.getenv("QDRANT_URL", "http://127.0.0.1:6333")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "bone_edu_docs")
VECTOR_SIZE = int(os.getenv("EMBEDDING_DIM", "1536"))

DEFAULT_SCORE_THRESHOLD = float(os.getenv("QDRANT_SCORE_THRESHOLD", "0.15"))
DEFAULT_QUERY_SCORE_THRESHOLD = float(os.getenv("QDRANT_QUERY_SCORE_THRESHOLD", "0.15"))
DEFAULT_ENABLE_GIBBERISH_FILTER = os.getenv("QDRANT_ENABLE_GIBBERISH_FILTER", "0") == "1"
DEFAULT_EXCLUDE_PLACEHOLDERS = os.getenv("QDRANT_EXCLUDE_PLACEHOLDERS", "1") == "1"
DEFAULT_DEBUG = os.getenv("QDRANT_DEBUG", "0") == "1"

# Qdrant 預設單次 JSON payload 上限約 32MB。
# 這裡保守抓 20MB，避免臨界值爆掉。
MAX_QDRANT_BATCH_BYTES = int(os.getenv("QDRANT_MAX_BATCH_BYTES", str(20 * 1024 * 1024)))

# 避免單批 points 太多，即使 payload 不大也比較穩。
MAX_QDRANT_BATCH_POINTS = int(os.getenv("QDRANT_MAX_BATCH_POINTS", "64"))


def is_gibberish(text: str) -> bool:
    if not text:
        return True

    t = text.strip()
    if len(t) < 20:
        return True

    mojibake_markers = "åäçéèï¼ã¢âœ"
    mojibake_count = sum(1 for ch in t if ch in mojibake_markers)
    mojibake_ratio = mojibake_count / max(len(t), 1)

    bad = sum(1 for ch in t if ord(ch) < 32 or ch in "�˙ːʊ̊")
    ratio_bad = bad / max(len(t), 1)

    good = sum(
        1
        for ch in t
        if ("\u4e00" <= ch <= "\u9fff") or ch.isalnum() or ch in "，。,.%()/- \n\r\t：:、;；[]{}"
    )
    ratio_good = good / max(len(t), 1)

    return (
        ratio_bad > 0.05
        or ratio_good < 0.35
        or mojibake_ratio > 0.15   #過濾趴數
    )
    


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

        # 建立常用 payload index，查詢 filter 會比較穩
        index_fields = [
            ("material_id", PayloadSchemaType.KEYWORD),
            ("type", PayloadSchemaType.KEYWORD),
            ("bone_id", PayloadSchemaType.INTEGER),
            ("small_bone_id", PayloadSchemaType.INTEGER),
            ("page", PayloadSchemaType.INTEGER),
            ("slide", PayloadSchemaType.INTEGER),
            ("chunk_index", PayloadSchemaType.INTEGER),
        ]

        for field_name, schema in index_fields:
            try:
                self.client.create_payload_index(
                    collection_name=QDRANT_COLLECTION,
                    field_name=field_name,
                    field_schema=schema,
                )
            except Exception:
                # 已存在或 client 版本差異時忽略
                pass

    def collection_info(self) -> Dict[str, Any]:
        info = self.client.get_collection(QDRANT_COLLECTION)
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

            text = d.get("text", "") or ""

            # 防止單一 chunk 太肥。正常 RAG chunk 不該大到幾萬字。
            # 如果真的很大，先截斷避免 Qdrant payload 爆掉。
            if isinstance(text, str) and len(text) > 12000:
                text = text[:12000] + "\n...[TRUNCATED_FOR_QDRANT_PAYLOAD]"

            payload = {
                "text": text,
                "material_id": d.get("material_id"),
                "title": d.get("title"),
                "type": d.get("type") or d.get("source_type"),
                "language": d.get("language"),
                "style": d.get("style"),
                "file_path": d.get("file_path") or d.get("source_file"),
                "page": d.get("page"),
                "slide": d.get("slide"),
                "bone_id": d.get("bone_id"),
                "small_bone_id": d.get("small_bone_id") or d.get("bone_small_id"),
                "chunk_index": d.get("chunk_index"),
                "tags": d.get("tags") or [],
            }

            points.append(PointStruct(id=pid, vector=emb, payload=payload))

        if not points:
            print("⚠️ upsert_docs skipped: points is empty (all docs invalid/empty)")
            return

        def estimate_batch_size(batch_points: List[PointStruct]) -> int:
            """
            粗估 Qdrant upsert JSON 大小。
            不需要百分百精準，只要避免超過 32MB 即可。
            """
            try:
                data = {
                    "points": [
                        {
                            "id": p.id,
                            "vector": p.vector,
                            "payload": p.payload,
                        }
                        for p in batch_points
                    ]
                }
                return len(json.dumps(data, ensure_ascii=False, default=str).encode("utf-8"))
            except Exception:
                # 估算失敗就當作超大，強制切批
                return MAX_QDRANT_BATCH_BYTES + 1

        def flush_batch(batch_points: List[PointStruct], batch_no: int) -> None:
            if not batch_points:
                return

            approx_mb = estimate_batch_size(batch_points) / 1024 / 1024
            print(
                f"[QDRANT] upsert batch {batch_no}: "
                f"{len(batch_points)} points, approx={approx_mb:.2f}MB"
            )

            self.client.upsert(
                collection_name=QDRANT_COLLECTION,
                points=batch_points,
            )

        batch: List[PointStruct] = []
        batch_no = 1
        total_points = len(points)

        for p in points:
            candidate = batch + [p]
            candidate_size = estimate_batch_size(candidate)

            if batch and (
                candidate_size > MAX_QDRANT_BATCH_BYTES
                or len(candidate) > MAX_QDRANT_BATCH_POINTS
            ):
                flush_batch(batch, batch_no)
                batch_no += 1
                batch = [p]
            else:
                batch = candidate

        if batch:
            flush_batch(batch, batch_no)

        print(f"[QDRANT] upsert_docs done: {total_points} points")
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
        score_threshold: float = DEFAULT_SCORE_THRESHOLD,
        enable_gibberish_filter: bool = DEFAULT_ENABLE_GIBBERISH_FILTER,
        exclude_placeholders: bool = DEFAULT_EXCLUDE_PLACEHOLDERS,
        debug: bool = DEFAULT_DEBUG,
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
        limit = max(top_k * 3, top_k)

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

        hits: List[Any] = []
        filtered_by_score = 0
        filtered_by_empty = 0
        filtered_by_placeholder = 0
        filtered_by_gibberish = 0

        for p in raw:
            score = float(getattr(p, "score", 0) or 0)
            if score < score_threshold:
                filtered_by_score += 1
                continue

            payload = getattr(p, "payload", None) or {}
            text = (payload.get("text", "") or "").strip()
            if not text:
                filtered_by_empty += 1
                continue

            if exclude_placeholders and (
                text.startswith("[SCANNED/NO-TEXT PDF]") or text.startswith("[MISSING FILE]")
            ):
                filtered_by_placeholder += 1
                continue

            if enable_gibberish_filter and is_gibberish(text):
                filtered_by_gibberish += 1
                continue

            hits.append(p)
            if len(hits) >= top_k:
                break

        if debug:
            print(
                "[QDRANT.search] "
                f"raw={len(raw)} kept={len(hits)} top_k={top_k} "
                f"score_threshold={score_threshold} "
                f"filtered(score={filtered_by_score}, empty={filtered_by_empty}, "
                f"placeholder={filtered_by_placeholder}, gibberish={filtered_by_gibberish}) "
                f"bone_id={bone_id} small_bone_id={small_bone_id}"
            )

        return hits

    # -----------------------------
    # Query (return simplified dicts)
    # -----------------------------
    def query(
        self,
        query_text: str,
        embed_fn,
        top_k: int = 5,
        score_threshold: float = DEFAULT_QUERY_SCORE_THRESHOLD,
        bone_id: Optional[int] = None,
        small_bone_id: Optional[int] = None,
        enable_gibberish_filter: bool = DEFAULT_ENABLE_GIBBERISH_FILTER,
        exclude_placeholders: bool = DEFAULT_EXCLUDE_PLACEHOLDERS,
        debug: bool = DEFAULT_DEBUG,
    ) -> List[Dict[str, Any]]:
        """
        直接給文字 query → embedding → search → 回傳 dict list（方便 rag_tool 用）
        """
        qvec = embed_fn(query_text)

        raw = self.search(
            embedding=qvec,
            top_k=top_k,
            bone_id=bone_id,
            small_bone_id=small_bone_id,
            score_threshold=score_threshold,
            enable_gibberish_filter=enable_gibberish_filter,
            exclude_placeholders=exclude_placeholders,
            debug=debug,
        )

        hits: List[Dict[str, Any]] = []
        for p in raw:
            score = float(getattr(p, "score", 0) or 0)
            payload = getattr(p, "payload", None) or {}
            hits.append({
                "score": score,
                "payload": payload,
            })

        if debug:
            print(f"[QDRANT.query] query_text_len={len(query_text)} kept_hits={len(hits)}")

        return hits