# main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# 引入你自己的 router（檔名 router.py）
from router import router as gala_router

# ==========================================
# FastAPI App（共用的主入口）
# ==========================================
app = FastAPI()

# CORS 設定（看之後要不要改成只開放特定網域）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],      # TODO: 未來可改成 ["http://localhost:3000", ...]
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 掛載 GalaBone 相關 API
# 如果希望路徑保持一樣（/predict），就不要加 prefix
# 想要變成 /gala/predict 再加 prefix="/gala"
app.include_router(gala_router)
# app.include_router(gala_router, prefix="/gala", tags=["GalaBone"])
