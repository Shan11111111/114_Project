# s2_agent/router.py
from fastapi import APIRouter
from .materials import router as materials_router
from .rag import router as rag_router
from .s0_bridge import router as s0_bridge_router
from .api_router import router as api_router      # ★ 新增這行

router = APIRouter()
router.include_router(materials_router)
router.include_router(rag_router)
router.include_router(s0_bridge_router)
router.include_router(api_router)                 # ★ 再掛進來
