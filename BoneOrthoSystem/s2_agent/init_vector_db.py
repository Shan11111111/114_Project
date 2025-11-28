from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams

# === 連線到你剛剛 docker 起來的 Qdrant ===
client = QdrantClient(
    host="localhost",
    port=6333,
)

COLLECTION_NAME = "bone_teaching_materials"

def main():
    vector_size = 1536   # 先假設你們用的是 1536 維的 embedding（像 OpenAI text-embedding-3-large）
    
    # 如果已經存在就會重建（把原本資料洗掉）
    client.recreate_collection(
        collection_name=COLLECTION_NAME,
        vectors_config=VectorParams(
            size=vector_size,
            distance=Distance.COSINE,
        ),
    )
    print(f"✅ Collection '{COLLECTION_NAME}' is ready (dim={vector_size}).")

if __name__ == "__main__":
    main()
