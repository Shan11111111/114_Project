# s0_annotation/backend/__init__.py
from fastapi import APIRouter
from .annotations import router as annotations_router
from .big_bones import router as big_bones_router
from .small_bones import router as small_bones_router
# 如果你還有 cases.py 等，也一併 import
try:
    from .cases import router as cases_router
except ImportError:
    cases_router = None

router = APIRouter()
router.include_router(annotations_router)
router.include_router(big_bones_router)
router.include_router(small_bones_router)
if cases_router is not None:
    router.include_router(cases_router)
