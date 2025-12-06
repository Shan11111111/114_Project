# BoneOrthoBackend/s0_annotation/__init__.py
from fastapi import APIRouter
from .bones import router as bones_router
from .annotations import router as annotations_router
from .cases import router as cases_router

router = APIRouter()
# 每個功能自己決定 prefix，這裡只單純 include
router.include_router(bones_router)
router.include_router(annotations_router)
router.include_router(cases_router)
