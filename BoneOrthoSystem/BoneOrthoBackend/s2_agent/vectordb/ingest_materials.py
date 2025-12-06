# s2_agent/vectordb/ingest_materials.py
from pathlib import Path
from typing import Dict, Any, List

from db import get_connection
from shared.vector_client import VectorStore
from s2_agent.service import embed_text  # 等一下會用到

# 指向 BoneOrthoBackend/s2_agent/vectordb/materials
MATERIAL_ROOT = Path(__file__).resolve().parent / "materials"


def _fetch_material(material_id: int) -> Dict[str, Any]:
    sql = """
    SELECT MaterialId, Type, Language, Style, Title,
           StructureJson, FilePath, CreatedAt, BoneId, BoneDetailId
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
    typ = row["Type"]
    rel = row["FilePath"]
    full_path = MATERIAL_ROOT / rel

    if typ == "pdf":
        from langchain_community.document_loaders import PyPDFLoader
        loader = PyPDFLoader(str(full_path))
        docs = loader.load_and_split()
        chunks = []
        for i, d in enumerate(docs):
            chunks.append(
                {
                    "text": d.page_content,
                    "page": d.metadata.get("page", None),
                    "chunk_index": i,
                }
            )
        return chunks

    elif typ in ("txt", "note"):
        text = full_path.read_text(encoding="utf-8")
        return [{"text": text, "page": None, "chunk_index": 0}]

    else:
        raise NotImplementedError(f"不支援的 Type: {typ}")


def index_material(material_id: int) -> None:
    """
    給 router 用的：針對單一 MaterialId 做向量化 + 寫進 Qdrant。
    """
    vs = VectorStore()
    vs.ensure_collection()

    row = _fetch_material(material_id)
    chunks = _load_chunks(row)

    docs = []
    for ch in chunks:
        emb = embed_text(ch["text"])
        docs.append(
            {
                "embedding": emb,
                "text": ch["text"],
                "material_id": row["MaterialId"],
                "title": row["Title"],
                "type": row["Type"],
                "language": row["Language"],
                "style": row["Style"],
                "file_path": row["FilePath"],
                "bone_id": row["BoneId"],
                "bone_detail_id": row["BoneDetailId"],
                "page": ch["page"],
                "chunk_index": ch["chunk_index"],
            }
        )

    vs.upsert_docs(docs)
    print(f"✅ 材料 {material_id} 已寫入向量庫")


# 如果你還是想一次重建整個庫，也可以保留這個 CLI 用法
def index_all_materials() -> None:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT MaterialId FROM agent.TeachingMaterial")
        ids = [row[0] for row in cur.fetchall()]

    for mid in ids:
        index_material(mid)


if __name__ == "__main__":
    index_all_materials()
