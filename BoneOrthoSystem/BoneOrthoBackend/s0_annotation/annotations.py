# BoneOrthoBackend/s0_annotation/annotations.py
from fastapi import APIRouter
from typing import List, Optional
from pydantic import BaseModel

from db import query_all, execute

router = APIRouter(prefix="/s0", tags=["s0_annotations"])

# --------- Pydantic Models ---------

class BBox(BaseModel):
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
    smallBoneId: Optional[int]
    x_min: float
    y_min: float
    x_max: float
    y_max: float

# --------- API：儲存標註 ---------

@router.post("/annotations/save")
def save_annotations(payload: SaveAnnotationsIn):
    """
    一次把某個 ImageCaseId 的所有 bbox 存起來：
    - 先刪掉舊的
    - 再把新的逐筆 insert
    """
    delete_sql = "DELETE FROM vision.ImageAnnotation WHERE ImageCaseId = ?;"
    execute(delete_sql, [payload.imageCaseId])

    insert_sql = """
    INSERT INTO vision.ImageAnnotation
    (ImageCaseId, SmallBoneId, XMin, YMin, XMax, YMax, CreatedAt)
    VALUES (?, ?, ?, ?, ?, ?, SYSDATETIME());
    """

    for b in payload.boxes:
        execute(insert_sql, [
            payload.imageCaseId,
            b.smallBoneId,
            b.x_min,
            b.y_min,
            b.x_max,
            b.y_max,
        ])

    return {"status": "ok"}

# --------- API：讀取標註 ---------

@router.get("/annotations/{case_id}", response_model=List[AnnotationOut])
def get_annotations(case_id: int):
    sql = """
    SELECT AnnotationId, ImageCaseId, SmallBoneId,
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
            smallBoneId=r["SmallBoneId"],
            x_min=r["XMin"],
            y_min=r["YMin"],
            x_max=r["XMax"],
            y_max=r["YMax"],
        )
        for r in rows
    ]
