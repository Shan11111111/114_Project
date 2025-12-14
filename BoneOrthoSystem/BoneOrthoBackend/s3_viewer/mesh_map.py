from fastapi import APIRouter, HTTPException
from db import query_one

router = APIRouter(prefix="/s3", tags=["S3 Viewer"])

@router.get("/mesh-map/{mesh_name}")
def get_mesh_map(mesh_name: str):
    """
    從 GLB 的 mesh 名稱找到 SmallBoneId。
    支援：
    - GLB:  Frontal_bone
    - DB:   Frontal bone
    """
    row = query_one(
        """
        SELECT TOP (1) SmallBoneId, MeshName
        FROM [model].[BoneMeshMap]
        WHERE MeshName = ?
           OR MeshName = REPLACE(?, '_', ' ')
        """,
        mesh_name,
        mesh_name,
    )

    if not row:
        raise HTTPException(
            status_code=404,
            detail=f"MeshName '{mesh_name}' not found in model.BoneMeshMap",
        )

    return {
        "smallBoneId": row.SmallBoneId,
        "meshName": row.MeshName,
    }
