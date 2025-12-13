from fastapi import APIRouter
from .mesh_map import router as mesh_map_router
from .bones import router as bones_router
from .scene import router as scene_router

router = APIRouter()
router.include_router(mesh_map_router)
router.include_router(bones_router)
router.include_router(scene_router)
