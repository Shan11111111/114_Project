# BoneOrthoBackend/s3_viewer/router.py
from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from .bones import get_bone_list
from .mesh_map import get_mesh_map

router = APIRouter(prefix="/s3", tags=["s3"])


@router.get("/bone-list")
def api_bone_list():
    data = get_bone_list()
    # 若有 detail 代表錯誤，回 500（前端才知道真的爆了）
    if isinstance(data, dict) and "detail" in data:
        return JSONResponse(status_code=500, content=data)
    return data


@router.get("/mesh-map/{mesh_name}")
def api_mesh_map(mesh_name: str):
    data = get_mesh_map(mesh_name)
    if isinstance(data, dict) and "detail" in data:
        return JSONResponse(status_code=404, content=data)
    return data

