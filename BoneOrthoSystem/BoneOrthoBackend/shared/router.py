# shared/router.py

from fastapi import APIRouter

# 統一給 app.py 匯入的 router 物件
router = APIRouter()

# 之後如果有其他子路由，可以在這裡 include 進來，例如：
# from .bones import router as bones_router
# router.include_router(bones_router, prefix="/bones", tags=["bones"])
