from pathlib import Path
from typing import Dict, Any, List, Union

from db import get_connection
from shared.vector_client import VectorStore
from s2_agent.service import embed_text

# 指向 BoneOrthoBackend/s2_agent/vectordb/materials
MATERIAL_ROOT = Path(__file__).resolve().parent / "materials"


def _fetch_material(material_id: Union[str, bytes]) -> Dict[str, Any]:
    """
    material_id: SQL Server uniqueidentifier，可用字串形式傳入（GUID）
    """
    sql = """
    SELECT MaterialId, Type, Language, Style, Title,
           StructureJson, FilePath, CreatedAt, BoneId, BoneSmallId
    FROM agent.TeachingMaterial
    WHERE MaterialId = ?
    """
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, material_id)
        row = cur.fetchone()
        if not row:
            raise ValueError(f"TeachingMaterial {material_id} not found")
        cols = [c[0] for c in cur.description]
    return dict(zip(cols, row))


def _load_chunks(row: Dict[str, Any]) -> List[Dict[str, Any]]:
    typ = (row.get("Type") or "").lower()
    rel = row["FilePath"]
    full_path = MATERIAL_ROOT / rel

    if not full_path.exists():
        raise FileNotFoundError(f"Material file not found: {full_path}")

    if typ == "pdf":
        from langchain_community.document_loaders import PyPDFLoader

        loader = PyPDFLoader(str(full_path))
        docs = loader.load_and_split()

        chunks: List[Dict[str, Any]] = []
        for i, d in enumerate(docs):
            chunks.append(
                {
                    "text": d.page_content,
                    "page": d.metadata.get("page", None),
                    "chunk_index": i,
                }
            )
        return chunks

    if typ in ("txt", "note"):
        text = full_path.read_text(encoding="utf-8")
        return [{"text": text, "page": None, "chunk_index": 0}]

    raise NotImplementedError(f"不支援的 Type: {typ}")


def index_material(material_id: str) -> None:
    """
    給 router 用的：針對單一 MaterialId (GUID) 做向量化 + 寫進 Qdrant。
    """
    vs = VectorStore()
    vs.ensure_collection()

    # SQL Server uniqueidentifier：用字串最穩
    row = _fetch_material(material_id)
    chunks = _load_chunks(row)

    docs = []
    for ch in chunks:
        emb = embed_text(ch["text"])
        docs.append(
            {
                "embedding": emb,
                "text": ch["text"],
                "material_id": str(row["MaterialId"]),  # ✅ 保證序列化成字串
                "title": row.get("Title"),
                "type": row.get("Type"),
                "language": row.get("Language"),
                "style": row.get("Style"),
                "file_path": row.get("FilePath"),
                "bone_id": row.get("BoneId"),
                "bone_small_id": row.get("BoneSmallId"),
                "page": ch.get("page"),
                "chunk_index": ch.get("chunk_index"),
            }
        )

    vs.upsert_docs(docs)
    print(f"✅ 材料 {material_id} 已寫入向量庫")


def index_all_materials() -> None:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT MaterialId FROM agent.TeachingMaterial")
        ids = [str(row[0]) for row in cur.fetchall()]

    for mid in ids:
        index_material(mid)


if __name__ == "__main__":
    index_all_materials()
