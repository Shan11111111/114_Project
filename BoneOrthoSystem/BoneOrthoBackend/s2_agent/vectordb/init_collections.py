# s2_agent/vectordb/init_collections.py
import os

from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "bone_edu_docs")
VECTOR_SIZE = int(os.getenv("EMBEDDING_DIM", "1536"))

def main():
    client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)
    client.recreate_collection(
        collection_name=QDRANT_COLLECTION,
        vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
    )
    print(f"✅ Collection `{QDRANT_COLLECTION}` created (dim={VECTOR_SIZE})")

if __name__ == "__main__":
    main()
