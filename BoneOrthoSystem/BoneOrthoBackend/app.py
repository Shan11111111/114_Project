from dotenv import load_dotenv
import os

# 1) 一開始就先載入 .env
load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    print("⚠️ WARNING: OPENAI_API_KEY 未設定，S2 會使用假資料，不會真的叫 LLM。")
else:
    print("✅ OPENAI_API_KEY 已載入，長度 =", len(OPENAI_API_KEY))

# 2) 再來才 import FastAPI / 各子系統 router
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from s0_annotation import router as s0_router
from s1_detection.router import router as s1_router
from s2_agent import router as s2_router
from s3_viewer.router import router as s3_router
from shared.router import router as shared_router
from s2_agent.s0_bridge import router as s0_bridge_router

from s2_agent.legacy_agent.backend.app.main import app as s2_legacy_app




app = FastAPI(
    title="BoneOrtho Backend",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {
        "status": "ok",
        "message": "BoneOrtho Backend running",
        "modules": ["s0", "s1", "s2", "s3"],
    }


app.include_router(shared_router, prefix="/shared")
app.include_router(s0_router)
app.include_router(s1_router)
app.include_router(s2_router)
app.include_router(s3_router)
app.include_router(s0_bridge_router, prefix="/s2")

app.mount("/s2x", s2_legacy_app)

