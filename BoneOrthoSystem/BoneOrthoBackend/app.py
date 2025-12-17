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
from fastapi.staticfiles import StaticFiles

from s0_annotation import router as s0_router
from s1_detection.router import router as s1_router
from s2_agent import router as s2_router
from s3_viewer.router import router as s3_router
from shared.router import router as shared_router
from s2_agent.s0_bridge import router as s0_bridge_router
from s2_agent.s1_handoff import router as s1_handoff_router
from s2_agent.ensure_title import router as ensure_title_router

from s2_agent.legacy_agent.backend.app.main import app as s2_legacy_app


# ==========================================
#  跨主機通用：自動尋找 BoneOrthoSystem 根目錄
#  目的：把 /public 掛到 BoneOrthoSystem/public（S1 存圖的位置）
# ==========================================
def find_project_root(target_folder="BoneOrthoSystem") -> str:
    current_path = os.path.abspath(__file__)
    while True:
        parent = os.path.dirname(current_path)
        if parent == current_path:
            raise RuntimeError(f"❌ 無法找到 {target_folder} 根目錄")
        if os.path.basename(parent) == target_folder:
            return parent
        current_path = parent


app = FastAPI(
    title="BoneOrtho Backend",
    version="0.1.0",
)

# ✅ CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ✅ 靜態檔案：讓 DB 存的 /public/bone_images/... 真的能被打到
#    S1 存圖：BoneOrthoSystem/public/bone_images
PROJECT_ROOT = find_project_root("BoneOrthoSystem")
PUBLIC_DIR = os.path.join(PROJECT_ROOT, "public")
os.makedirs(PUBLIC_DIR, exist_ok=True)

print("📌 PUBLIC_DIR =", PUBLIC_DIR)
app.mount("/public", StaticFiles(directory=PUBLIC_DIR), name="public")


@app.get("/")
def root():
    return {
        "status": "ok",
        "message": "BoneOrtho Backend running",
        "modules": ["s0", "s1", "s2", "s3"],
    }


# ✅ routers
app.include_router(shared_router, prefix="/shared")
app.include_router(s0_router)
app.include_router(s1_router)
app.include_router(s2_router)
app.include_router(s3_router)
app.include_router(s0_bridge_router, prefix="/s2")
app.include_router(s1_handoff_router)
app.include_router(ensure_title_router)

# ✅ legacy S2（維持你原本行為）
app.mount("/s2x", s2_legacy_app)
