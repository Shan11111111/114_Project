# s3_viewer/router.py
from fastapi import APIRouter
from pydantic import BaseModel
from typing import List

router = APIRouter()

class MeshState(BaseModel):
    meshName: str
    smallBoneId: int
    highlighted: bool

class SyncStateRequest(BaseModel):
    userId: str
    sceneId: str
    meshes: List[MeshState]

@router.post("/state/sync")
async def sync_viewer_state(req: SyncStateRequest):
    """
    S3：3D Viewer / MR 場景同步。
    TODO: 寫入某個 table 或 Redis 讓眼鏡那邊可以抓。
    先回原樣，方便前端測試。
    """
    return {"status": "ok", "meshCount": len(req.meshes)}
