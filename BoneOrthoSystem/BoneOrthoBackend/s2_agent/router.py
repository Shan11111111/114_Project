# s2_agent/router.py
from fastapi import APIRouter
from .materials import router as materials_router
from .rag import router as rag_router

router = APIRouter()
router.include_router(materials_router)
router.include_router(rag_router)
