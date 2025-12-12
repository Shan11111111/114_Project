from fastapi import APIRouter
from typing import List, Optional
from pydantic import BaseModel

from db import query_all, execute

router = APIRouter(prefix="/s0", tags=["s0_annotations"])


# ======== Pydantic models =========

class BBox(BaseModel):
    # 可以只標大類 / 或大+小
    boneId: Optional[int] = None
    smallBoneId: Optional[int] = None
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


# ======== APIs =========

@router.post("/annotations/save")
def save_annotations(payload: SaveAnnotationsIn):
    """
    一次把某個 ImageCaseId 的所有 bbox 存起來。
    先刪掉 vision.ImageAnnotation 裡這張圖、來源為 's0_annotation' 的舊資料，
    再全部重插一遍（覆蓋式標註）。
    """
    image_case_id = payload.imageCaseId
    boxes = payload.boxes or []

    # 1) 先清掉舊的 s0_annotation 標註
    delete_sql = """
    DELETE FROM vision.ImageAnnotation
    WHERE ImageCaseId = ? AND Source = 's0_annotation'
    """
    execute(delete_sql, [image_case_id])

    # 如果清空也算成功
    if not boxes:
        return {"ok": True, "imageCaseId": image_case_id, "count": 0}

    # 2) 逐筆插入新的標註
    # ⚠ 欄位名稱要跟 Table 一致：
    #   ImageCaseId, BoneId, SmallBoneId, XMin, YMin, XMax, YMax, Source
    insert_sql = """
    INSERT INTO vision.ImageAnnotation (
        ImageCaseId,
        BoneId,
        SmallBoneId,
        XMin,
        YMin,
        XMax,
        YMax,
        Source
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 's0_annotation')
    """

    for b in boxes:
        execute(
            insert_sql,
            [
                image_case_id,
                b.boneId,
                b.smallBoneId,
                b.x_min,
                b.y_min,
                b.x_max,
                b.y_max,
            ],
        )

    return {
        "ok": True,
        "imageCaseId": image_case_id,
        "count": len(boxes),
    }


@router.get("/annotations/{case_id}", response_model=List[AnnotationOut])
def list_annotations(case_id: int):
    """
    把某張圖（ImageCaseId）的所有標註框抓出來。
    沒有資料就回傳空陣列，不丟 404、不丟 500。
    只抓 Source = 's0_annotation'（S0 標註工具的標註）。
    """
    sql = """
    SELECT
        ia.AnnotationId AS annotationId,
        ia.ImageCaseId  AS imageCaseId,
        ia.BoneId       AS boneId,
        ia.SmallBoneId  AS smallBoneId,
        ia.XMin         AS x_min,
        ia.YMin         AS y_min,
        ia.XMax         AS x_max,
        ia.YMax         AS y_max
    FROM vision.ImageAnnotation AS ia
    WHERE ia.ImageCaseId = ?
      AND ia.Source = 's0_annotation'
    ORDER BY ia.AnnotationId
    """
    rows = query_all(sql, [case_id])
    return rows
