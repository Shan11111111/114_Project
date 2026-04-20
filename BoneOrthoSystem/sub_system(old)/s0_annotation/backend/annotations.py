# BoneOrthoBackend/s0_annotation/annotations.py
from fastapi import APIRouter, HTTPException
from typing import List, Optional
from pydantic import BaseModel

from db import query_all, execute

router = APIRouter(prefix="/s0", tags=["s0_annotations"])

class BBox(BaseModel):
    boneId: Optional[int]       # ★ 新增，大類
    smallBoneId: Optional[int]
    x_min: float
    y_min: float
    x_max: float
    y_max: float

class SaveAnnotationsIn(BaseModel):
    imageCaseId: int
    boxes: List[BBox]

class AnnotationOut(BaseModel):
    annotationId: int
    imageCaseId: int
    boneId: Optional[int] = None
    smallBoneId: Optional[int] = None
    x_min: float
    y_min: float
    x_max: float
    y_max: float

@router.post("/annotations/save")
def save_annotations(payload: SaveAnnotationsIn):
    """
    一次把某個 ImageCaseId 的所有 bbox 存起來
    """
    try:
        delete_sql = "DELETE FROM vision.ImageAnnotation WHERE ImageCaseId = ?;"
        execute(delete_sql, [payload.imageCaseId])

        # BoneOrthoBackend/s0_annotation/annotations.py

        insert_sql = """
INSERT INTO vision.ImageAnnotation
(ImageCaseId, BoneId, SmallBoneId, XMin, YMin, XMax, YMax, Source, CreatedAt)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, SYSDATETIME());
"""



        for b in payload.boxes:
    # 簡單檢查：至少要有 boneId 或 smallBoneId 其中一個
            if b.boneId is None and b.smallBoneId is None:
                raise HTTPException(
                status_code=400,
                detail="每個 bbox 至少要有 boneId 或 smallBoneId 其中一個"
            )
        execute(insert_sql, [
        payload.imageCaseId,
        b.boneId,        # 允許 None → 會變成 SQL NULL
        b.smallBoneId,
        b.x_min,
        b.y_min,
        b.x_max,
        b.y_max,
        "s0_annotation",
    ])


        return {"status": "ok"}
    except Exception as e:
        print("❌ Error in /s0/annotations/save:", repr(e))
        raise HTTPException(status_code=500, detail=f"/s0/annotations/save failed: {e}")

@router.get("/annotations/{case_id}", response_model=List[AnnotationOut])
def get_annotations(case_id: int):
    try:
        sql = """
        SELECT AnnotationId, ImageCaseId, BoneId, SmallBoneId,
       XMin, YMin, XMax, YMax
FROM vision.ImageAnnotation
WHERE ImageCaseId = ?
ORDER BY AnnotationId;
        """
        rows = query_all(sql, [case_id])
        return [
            AnnotationOut(
        annotationId=r["AnnotationId"],
        imageCaseId=r["ImageCaseId"],
        boneId=r["BoneId"],
        smallBoneId=r["SmallBoneId"],
        x_min=r["XMin"],
        y_min=r["YMin"],
        x_max=r["XMax"],
        y_max=r["YMax"],
            )
            for r in rows
        ]
    except Exception as e:
        print("❌ Error in /s0/annotations/{case_id}:", repr(e))
        raise HTTPException(status_code=500, detail=f"/s0/annotations/{case_id} failed: {e}")
