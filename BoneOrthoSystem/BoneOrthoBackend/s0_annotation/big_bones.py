# BoneOrthoBackend/s0_annotation/big_bones.py
from fastapi import APIRouter
from db import query_all

router = APIRouter(prefix="/s0", tags=["s0_bones"])


@router.get("/big-bones")
def get_big_bones():
    """
    取得 41 類大骨列表，給 S0 前端右邊 chip 用。
    對應資料表：dbo.Bone_Info（bone_id / bone_zh / bone_en）
    """

    sql = """
    SELECT
        b.bone_id,
        b.bone_zh,
        b.bone_en
    FROM dbo.Bone_Info AS b
    ORDER BY b.bone_id
    """
    rows = query_all(sql)

    # 確保回去的欄位名是前端在用的 bone_id / bone_zh / bone_en
    return [
        {
            "bone_id": row["bone_id"],
            "bone_zh": row["bone_zh"] or "",
            "bone_en": row["bone_en"] or "",
        }
        for row in rows
    ]
