# BoneOrthoBackend/s0_annotation/small_bones.py
from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional
from pydantic import BaseModel

from db import query_all

router = APIRouter(prefix="/s0", tags=["s0_small_bones"])


class SmallBoneOut(BaseModel):
    smallBoneId: int
    boneId: int
    nameZh: str
    nameEn: str
    serialNumber: Optional[str] = None   # ★ 改成 str
    place: Optional[str] = None
    note: Optional[str] = None



@router.get("/small-bones", response_model=List[SmallBoneOut])
def list_small_bones(
    boneId: int = Query(..., description="對應的大骨 bone_id")
):
    """
    依指定的大骨 boneId，列出底下所有小骨 (206 細項的一部分)：
    - 給前端第二層下拉選單用
    """
    sql = """
    SELECT 
        s.small_bone_id  AS smallBoneId,
        s.bone_id        AS boneId,
        s.small_bone_zh  AS nameZh,
        s.small_bone_en  AS nameEn,
        s.serial_number  AS serialNumber,
        s.place          AS place,
        s.note           AS note
    FROM [dbo].[bone.Bone_small] AS s
    WHERE s.bone_id = ?
    ORDER BY s.serial_number, s.small_bone_zh;
    """
    try:
        rows = query_all(sql, [boneId])
        return [
            SmallBoneOut(
                smallBoneId=r["smallBoneId"],
                boneId=r["boneId"],
                nameZh=r["nameZh"],
                nameEn=r["nameEn"],
                serialNumber=r["serialNumber"],
                place=r["place"],
                note=r["note"],
            )
            for r in rows
        ]
    except Exception as e:
        print("❌ Error in /s0/small-bones:", repr(e))
        raise HTTPException(status_code=500, detail=f"/s0/small-bones failed: {e}")
