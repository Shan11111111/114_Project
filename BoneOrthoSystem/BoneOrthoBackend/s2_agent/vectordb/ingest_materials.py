from dotenv import load_dotenv
from pathlib import Path

# ----------------------------
# Load .env (BoneOrthoBackend/.env)
# ----------------------------
# 你原本寫 parents[2]，我保留；同時加 fallback，避免路徑變動就噴掉
ENV_CANDIDATES = [
    Path(__file__).resolve().parents[2] / ".env",  # BoneOrthoBackend/.env (照你要求)
    Path(__file__).resolve().parents[1] / ".env",
    Path(__file__).resolve().parents[3] / ".env",
]
for p in ENV_CANDIDATES:
    if p.exists():
        load_dotenv(p)
        break

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
        # 檔案路徑對不上：也要回一個 chunk，讓你查得到錯在哪
        return [{
            "text": f"[MISSING FILE] Title={row.get('Title')} FilePath={rel}",
            "page": None,
            "chunk_index": 0,
        }]

    if typ == "pdf":
        docs = []

        # ✅ 優先用 PyMuPDF（對中文通常更穩）
        try:
            from langchain_community.document_loaders import PyMuPDFLoader
            loader = PyMuPDFLoader(str(full_path))
            docs = loader.load()
        except Exception as e:
            print(f"⚠️ PyMuPDFLoader failed, fallback PyPDFLoader: {e}")

        # fallback：PyPDFLoader
        if not docs:
            from langchain_community.document_loaders import PyPDFLoader
            loader = PyPDFLoader(str(full_path))
            # PyPDFLoader 多半需要 split 才會有 page meta
            docs = loader.load_and_split()

        chunks: List[Dict[str, Any]] = []
        for i, d in enumerate(docs):
            txt = (getattr(d, "page_content", None) or "").strip()
            if not txt:
                continue
            meta = getattr(d, "metadata", {}) or {}
            chunks.append({
                "text": txt,
                "page": meta.get("page", None),
                "chunk_index": i,
            })

        # ✅ 關鍵：如果抽不到任何文字（掃描 PDF），塞 fallback chunk
        if not chunks:
            return [{
                "text": f"[SCANNED/NO-TEXT PDF] {row.get('Title')} (file={rel})",
                "page": None,
                "chunk_index": 0,
            }]

        return chunks

    if typ in ("txt", "note"):
        text = full_path.read_text(encoding="utf-8").strip()
        if not text:
            text = f"[EMPTY TEXT FILE] {row.get('Title')} (file={rel})"
        return [{"text": text, "page": None, "chunk_index": 0}]

    raise NotImplementedError(f"不支援的 Type: {typ}")


def index_material(material_id: str) -> None:
    """
    給 router 用的：針對單一 MaterialId (GUID) 做向量化 + 寫進 Qdrant。
    """
    vs = VectorStore()
    vs.ensure_collection()

    row = _fetch_material(material_id)
    chunks = _load_chunks(row)
    if not chunks:
        print(f"⚠️ Material {material_id} has 0 chunks, skip upsert")
        return

    docs = []
    for ch in chunks:
        emb = embed_text(ch["text"])
        docs.append({
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
        })

    vs.upsert_docs(docs)
    print(f"✅ 材料 {material_id} 已寫入向量庫")


def index_all_materials() -> None:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT MaterialId FROM agent.TeachingMaterial")
        ids = [str(row[0]) for row in cur.fetchall()]

    for mid in ids:
        try:
            index_material(str(mid))
        except Exception as e:
            print(f"❌ index failed: MaterialId={mid}, err={e}")
            continue


if __name__ == "__main__":
    index_all_materials()
