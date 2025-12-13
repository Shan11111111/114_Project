# BoneOrthoBackend/s3_viewer/router.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional

from db import get_connection

router = APIRouter(prefix="/s3", tags=["S3 Viewer"])


# ---------- 1. MeshName → SmallBoneId ----------

@router.get("/mesh-map/{mesh_name}")
def get_small_bone_id_by_mesh(mesh_name: str):
    """
    前端丟 GLB 裡的 mesh.name 進來 → 回傳 SmallBoneId。
    來源表：model.BoneMeshMap (SmallBoneId, MeshName)
    """
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT SmallBoneId
            FROM model.BoneMeshMap
            WHERE MeshName = ?
            """,
            mesh_name,
        )
        row = cur.fetchone()

    if not row:
        raise HTTPException(
            status_code=404,
            detail=f"MeshName '{mesh_name}' not found in model.BoneMeshMap",
        )

    return {"mesh_name": mesh_name, "small_bone_id": row.SmallBoneId}


# ---------- 2. SmallBoneId → 骨頭資訊 ----------

class BoneInfo(BaseModel):
    small_bone_id: int
    bone_id: int
    bone_zh: str
    bone_en: str
    bone_region: Optional[str] = None
    bone_desc: Optional[str] = None


@router.get("/bones/{small_bone_id}", response_model=BoneInfo)
def get_bone_info(small_bone_id: int):
    """
    SmallBoneId → join bone.Bone_small + dbo.Bone_Info
    拿到骨頭中英名稱 / 區域 / 描述。
    """
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT
                s.small_bone_id,
                s.bone_id,
                COALESCE(s.small_bone_zh, b.bone_zh) AS bone_zh,
                COALESCE(s.small_bone_en, b.bone_en) AS bone_en,
                b.bone_region,
                b.bone_desc
            FROM bone.Bone_small AS s
            JOIN dbo.Bone_Info AS b
              ON s.bone_id = b.bone_id
            WHERE s.small_bone_id = ?
            """,
            small_bone_id,
        )
        row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail=f"SmallBoneId {small_bone_id} not found")

    return BoneInfo(
        small_bone_id=row.small_bone_id,
        bone_id=row.bone_id,
        bone_zh=row.bone_zh,
        bone_en=row.bone_en,
        bone_region=row.bone_region,
        bone_desc=row.bone_desc,
    )


# ---------- 3. 保留原本的 state/sync（之後 MR 用） ----------

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
    目前只是回傳 mesh 數量，詳細存 DB 之後再做。
    """
    return {"status": "ok", "meshCount": len(req.meshes)}
