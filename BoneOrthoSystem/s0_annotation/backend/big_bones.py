# BoneOrthoBackend/s0_annotation/big_bones.py
from fastapi import APIRouter, HTTPException
from typing import List
from pydantic import BaseModel

from db import query_all

router = APIRouter(prefix="/s0", tags=["s0_big_bones"])


class BigBoneOut(BaseModel):
    boneId: int
    nameZh: str
    nameEn: str
    region: str | None = None


@router.get("/big-bones", response_model=List[BigBoneOut])
def list_big_bones():
    """
    列出全部大骨 (41 類)：
    - 給前端第一層下拉選單用
    """
    sql = """
    SELECT 
        b.bone_id      AS boneId,
        b.bone_zh      AS nameZh,
        b.bone_en      AS nameEn,
        b.bone_region  AS region
    FROM [dbo].[Bone_Info] AS b
    ORDER BY b.bone_region, b.bone_zh;
    """
    try:
        rows = query_all(sql)
        return [
            BigBoneOut(
                boneId=r["boneId"],
                nameZh=r["nameZh"],
                nameEn=r["nameEn"],
                region=r["region"],
            )
            for r in rows
        ]
    except Exception as e:
        print("❌ Error in /s0/big-bones:", repr(e))
        raise HTTPException(status_code=500, detail=f"/s0/big-bones failed: {e}")
