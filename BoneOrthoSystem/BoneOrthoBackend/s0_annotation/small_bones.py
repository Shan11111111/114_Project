# BoneOrthoBackend/s0_annotation/small_bones.py
from fastapi import APIRouter, Query
from db import query_all

router = APIRouter(prefix="/s0", tags=["s0_small_bones"])


@router.get("/small-bones")
def get_small_bones(boneId: int = Query(..., alias="boneId")):
    """
    取得某個大骨底下的小骨清單（206 細項之一）。
    表： [dbo].[bone.Bone_small]
    欄位：
      - small_bone_id
      - small_bone_zh
      - small_bone_en
      - serial_number  (代號)
      - place          (左右 / 中央…)
      - note           (備註)
      - bone_id        (對應 Bone_Info.bone_id)
    """

    sql = f"""
    SELECT
        s.small_bone_id,
        s.small_bone_zh,
        s.small_bone_en,
        s.serial_number,
        s.place,
        s.note
    FROM [dbo].[bone.Bone_small] AS s
    WHERE s.bone_id = {boneId}
    ORDER BY s.serial_number
    """

    rows = query_all(sql)

    return [
        {
            "small_bone_id": row["small_bone_id"],
            "small_bone_zh": row["small_bone_zh"],
            "small_bone_en": row["small_bone_en"],
            "serial_number": row["serial_number"],
            "place": row["place"],
            "note": row["note"],
        }
        for row in rows
    ]
