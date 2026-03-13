# BoneOrthoBackend/app.py
from dotenv import load_dotenv
import os
import uuid
from pathlib import Path

# 1) 一開始就先載入 .env
load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    print("⚠️ WARNING: OPENAI_API_KEY 未設定，S2 會使用假資料，不會真的叫 LLM。")
else:
    print("✅ OPENAI_API_KEY 已載入，長度 =", len(OPENAI_API_KEY))

# 2) 再來才 import FastAPI / 各子系統 router
from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse


from s0_annotation import router as s0_router
from s1_detection.router import router as s1_router
from s2_agent.router import router as s2_router
from s3_viewer.router import router as s3_router
from shared.router import router as shared_router
from s2_agent.s0_bridge import router as s0_bridge_router
from s2_agent.s1_handoff import router as s1_handoff_router
from s2_agent.ensure_title import router as ensure_title_router

from s2_agent.legacy_agent.backend.app.main import app as s2_legacy_app

# 例：在你 FastAPI app = FastAPI() 之後
from s4_mr_bridge.router import router as mr_router
app.include_router(mr_router)


from auth.router import router as auth_router
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

DEV_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]


# ✅ CORS
app.add_middleware(
    CORSMiddleware,
    # allow_origins=["*"],
    allow_origins=DEV_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ✅ DEV 用：把未處理的 500 變成 JSON（讓 CORS header 能正常回到前端）
@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Internal Server Error",
            "path": str(request.url.path),
            "error": repr(exc),
        },
    )

# ✅ 靜態檔案：讓 DB 存的 /public/... 真的能被打到
PROJECT_ROOT = find_project_root("BoneOrthoSystem")
PUBLIC_DIR = os.path.join(PROJECT_ROOT, "public")
os.makedirs(PUBLIC_DIR, exist_ok=True)

# ✅ 你要的兩個資料夾：S1 bone_images、S2 user_upload_file
BONE_IMAGES_DIR = os.path.join(PUBLIC_DIR, "bone_images")
USER_UPLOAD_DIR = os.path.join(PUBLIC_DIR, "user_upload_file")
os.makedirs(BONE_IMAGES_DIR, exist_ok=True)
os.makedirs(USER_UPLOAD_DIR, exist_ok=True)

print("📌 PUBLIC_DIR =", PUBLIC_DIR)
print("📌 BONE_IMAGES_DIR =", BONE_IMAGES_DIR)
print("📌 USER_UPLOAD_DIR =", USER_UPLOAD_DIR)

app.mount("/public", StaticFiles(directory=PUBLIC_DIR), name="public")


@app.get("/")
def root():
    return {
        "status": "ok",
        "message": "BoneOrtho Backend running",
        "modules": ["s0", "s1", "s2", "s3"],
    }


# =========================================================
# ✅ Root /upload：給前端 llm/page.tsx 用（你現在就是打這裡）
# - 任何檔案都存到 BoneOrthoSystem/public/user_upload_file
# - 回傳 url 使用 /public/user_upload_file/...（避免 /s2x/uploads 路徑對不起來）
# =========================================================
_ALLOWED_UPLOAD_EXT = {
    # images
    "png", "jpg", "jpeg", "webp", "bmp",
    # docs
    "pdf", "txt", "csv",
    "ppt", "pptx",
    "doc", "docx",
    "xls", "xlsx",
}

def _ext_of(filename: str) -> str:
    parts = (filename or "").rsplit(".", 1)
    if len(parts) == 2:
        return parts[1].lower()
    return ""

@app.post("/upload")
async def root_upload(file: UploadFile = File(...)):
    original = file.filename or ""
    ext = _ext_of(original)

    # 你要嚴格就開這段；不想卡人就把這段註解
    if ext and ext not in _ALLOWED_UPLOAD_EXT:
        raise HTTPException(status_code=400, detail=f"不支援的檔案格式: .{ext}")

    # 統一用 uuid 避免撞名（S1/S2 同時上傳也不會互撞）
    safe_ext = ext or "bin"
    fname = f"s2_{uuid.uuid4().hex}.{safe_ext}"
    fpath = Path(USER_UPLOAD_DIR) / fname

    data = await file.read()
    with open(fpath, "wb") as f:
        f.write(data)

    return {
        "url": f"/public/user_upload_file/{fname}",
        "filetype": safe_ext,
        "filename": original,
        "storage": "public/user_upload_file",
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


app.include_router(auth_router)


# ✅ legacy S2（維持你原本行為）
app.mount("/s2x", s2_legacy_app)
