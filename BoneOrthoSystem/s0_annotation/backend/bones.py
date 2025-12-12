# BoneOrthoBackend/s0_annotation/bones.py
from fastapi import APIRouter, HTTPException
from db import query_all

router = APIRouter(prefix="/s0", tags=["s0_bones"])

@router.get("/bones")
def list_bones():
    """
    給前端做下拉選單：
    回傳 small bone + 對應的大骨資訊
    """
    sql = """
    SELECT 
        s.small_bone_id AS smallBoneId,
        s.small_bone_zh AS nameZh,
        s.small_bone_en AS nameEn,
        b.bone_id        AS boneId,
        b.bone_zh        AS boneZh,
        b.bone_en        AS boneEn
    FROM [dbo].[bone.Bone_small] AS s
    JOIN [dbo].[Bone_Info]      AS b ON s.bone_id = b.bone_id
    ORDER BY b.bone_region, b.bone_zh, s.serial_number;
    """
    try:
        rows = query_all(sql)
        return {"items": rows}
    except Exception as e:
        print("❌ Error in /s0/bones:", repr(e))
        raise HTTPException(status_code=500, detail=f"/s0/bones failed: {e}")
