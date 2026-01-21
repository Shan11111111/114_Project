# BoneOrthoBackend/s0_annotation/__init__.py
from fastapi import APIRouter

from .annotations import router as annotations_router
from .big_bones import router as big_bones_router
from .small_bones import router as small_bones_router

router = APIRouter()

# 基礎 routers
router.include_router(annotations_router)
router.include_router(big_bones_router)
router.include_router(small_bones_router)

# 可選：cases.py（有就掛，沒有就略過）
try:
    from .cases import router as cases_router  # type: ignore
    router.include_router(cases_router)
except Exception:
    pass
