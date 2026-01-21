# BoneOrthoBackend/s0_annotation/annotations.py
from fastapi import APIRouter
from typing import List, Optional, Any
from pydantic import BaseModel, Field
import json

from db import query_all, execute, execute_many  # ✅ 加 execute_many

router = APIRouter(prefix="/s0", tags=["s0_annotations"])


# ======== helpers =========

def _clamp01(v: float) -> float:
    if v < 0:
        return 0.0
    if v > 1:
        return 1.0
    return float(v)

def _normalize_aabb(xmin: float, ymin: float, xmax: float, ymax: float):
    xmin, ymin, xmax, ymax = map(_clamp01, (xmin, ymin, xmax, ymax))
    if xmax < xmin:
        xmin, xmax = xmax, xmin
    if ymax < ymin:
        ymin, ymax = ymax, ymin
    return xmin, ymin, xmax, ymax

def _aabb_to_poly(xmin: float, ymin: float, xmax: float, ymax: float):
    xmin, ymin, xmax, ymax = _normalize_aabb(xmin, ymin, xmax, ymax)
    p1 = (xmin, ymin)
    p2 = (xmax, ymin)
    p3 = (xmax, ymax)
    p4 = (xmin, ymax)
    cx = (xmin + xmax) / 2.0
    cy = (ymin + ymax) / 2.0
    poly = [[p1[0], p1[1]], [p2[0], p2[1]], [p3[0], p3[1]], [p4[0], p4[1]]]
    return poly, p1, p2, p3, p4, cx, cy

def _normalize_poly(poly: list[list[float]]) -> list[list[float]]:
    """Clamp each point to 0..1 and ensure 4 points."""
    out: list[list[float]] = []
    for p in poly:
        if not isinstance(p, (list, tuple)) or len(p) != 2:
            continue
        out.append([_clamp01(float(p[0])), _clamp01(float(p[1]))])
    return out

def _poly_to_aabb_and_center(poly: list[list[float]]):
    poly = _normalize_poly(poly)
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    xmin = _clamp01(min(xs))
    ymin = _clamp01(min(ys))
    xmax = _clamp01(max(xs))
    ymax = _clamp01(max(ys))
    cx = sum(xs) / len(xs)
    cy = sum(ys) / len(ys)
    return xmin, ymin, xmax, ymax, cx, cy


# ======== Pydantic models =========

class BBox(BaseModel):
    boneId: Optional[int] = None
    smallBoneId: Optional[int] = None

    x_min: float = Field(..., ge=0, le=1)
    y_min: float = Field(..., ge=0, le=1)
    x_max: float = Field(..., ge=0, le=1)
    y_max: float = Field(..., ge=0, le=1)

    # ✅ 旋轉框支援（前端可送其中一種）
    poly: Optional[List[List[float]]] = None     # [[x,y] * 4]
    polyJson: Optional[str] = None               # JSON string of poly

    # ✅ 可選：如果前端送 p1..p4
    p1x: Optional[float] = None
    p1y: Optional[float] = None
    p2x: Optional[float] = None
    p2y: Optional[float] = None
    p3x: Optional[float] = None
    p3y: Optional[float] = None
    p4x: Optional[float] = None
    p4y: Optional[float] = None

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
    poly: Optional[List[List[float]]] = None
    cx: Optional[float] = None
    cy: Optional[float] = None


# ======== APIs =========

@router.post("/annotations/save")
def save_annotations(payload: SaveAnnotationsIn):
    """
    覆蓋式標註：
    1) DELETE 舊資料（同 imageCaseId + source）
    2) 批次 INSERT 新資料（fast_executemany）
    """
    image_case_id = payload.imageCaseId
    boxes = payload.boxes or []

    # 1) 清舊的
    delete_sql = """
    DELETE FROM vision.ImageAnnotation
    WHERE ImageCaseId = ? AND Source = 's0_annotation'
    """
    execute(delete_sql, [image_case_id])

    if not boxes:
        return {"ok": True, "imageCaseId": image_case_id, "count": 0}

    # 2) 批次插入
    insert_sql = """
    INSERT INTO vision.ImageAnnotation (
        ImageCaseId,
        Source,
        BoneId,
        SmallBoneId,
        XMin,
        YMin,
        XMax,
        YMax,
        PolyJson,
        P1X, P1Y,
        P2X, P2Y,
        P3X, P3Y,
        P4X, P4Y,
        PolyIsNormalized,
        Cx,
        Cy
    )
    VALUES (
        ?, 's0_annotation', ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?,
        ?, ?,
        ?, ?, ?
    )
    """

    params_list = []
    for b in boxes:
        # 先有 AABB（舊前端相容）
        xmin, ymin, xmax, ymax = _normalize_aabb(b.x_min, b.y_min, b.x_max, b.y_max)

        # ✅ 1) 優先吃旋轉框：poly / polyJson / p1..p4
        poly: Optional[List[List[float]]] = None

        # (a) poly list
        if b.poly and isinstance(b.poly, list) and len(b.poly) == 4:
            poly = b.poly

        # (b) polyJson string
        if poly is None and b.polyJson:
            try:
                arr = json.loads(b.polyJson)
                if isinstance(arr, list) and len(arr) == 4:
                    poly = arr
            except Exception:
                poly = None

        # (c) p1..p4
        if poly is None and all(
            v is not None
            for v in [b.p1x, b.p1y, b.p2x, b.p2y, b.p3x, b.p3y, b.p4x, b.p4y]
        ):
            poly = [
                [float(b.p1x), float(b.p1y)],
                [float(b.p2x), float(b.p2y)],
                [float(b.p3x), float(b.p3y)],
                [float(b.p4x), float(b.p4y)],
            ]

        # ✅ 2) 沒有旋轉框就 fallback：用 AABB 生矩形
        if poly is None:
            poly, p1, p2, p3, p4, cx, cy = _aabb_to_poly(xmin, ymin, xmax, ymax)
        else:
            poly = _normalize_poly(poly)
            if len(poly) != 4:
                poly, p1, p2, p3, p4, cx, cy = _aabb_to_poly(xmin, ymin, xmax, ymax)
            else:
                # 用 poly 推回 AABB 與中心（DB XMin..YMax 也要對）
                xmin, ymin, xmax, ymax, cx, cy = _poly_to_aabb_and_center(poly)
                p1, p2, p3, p4 = poly[0], poly[1], poly[2], poly[3]

        poly_json = json.dumps(poly, ensure_ascii=False)

        params_list.append((
            image_case_id,
            b.boneId,
            b.smallBoneId,
            xmin, ymin, xmax, ymax,
            poly_json,
            p1[0], p1[1],
            p2[0], p2[1],
            p3[0], p3[1],
            p4[0], p4[1],
            1,          # PolyIsNormalized
            cx, cy
        ))

    execute_many(insert_sql, params_list, fast=True)
    return {"ok": True, "imageCaseId": image_case_id, "count": len(boxes)}


@router.get("/annotations/{case_id}", response_model=List[AnnotationOut])
def list_annotations(case_id: int):
    sql = """
    SELECT
        ia.AnnotationId AS annotationId,
        ia.ImageCaseId  AS imageCaseId,
        ia.BoneId       AS boneId,
        ia.SmallBoneId  AS smallBoneId,
        ia.XMin         AS x_min,
        ia.YMin         AS y_min,
        ia.XMax         AS x_max,
        ia.YMax         AS y_max,
        ia.PolyJson     AS polyJson,
        ia.Cx           AS cx,
        ia.Cy           AS cy,
        ia.P1X          AS p1x,
        ia.P1Y          AS p1y,
        ia.P2X          AS p2x,
        ia.P2Y          AS p2y,
        ia.P3X          AS p3x,
        ia.P3Y          AS p3y,
        ia.P4X          AS p4x,
        ia.P4Y          AS p4y
    FROM vision.ImageAnnotation AS ia
    WHERE ia.ImageCaseId = ?
      AND ia.Source = 's0_annotation'
    ORDER BY ia.AnnotationId
    """
    rows: List[dict[str, Any]] = query_all(sql, [case_id]) or []

    for r in rows:
        poly = None

        pj = r.get("polyJson")
        if pj:
            try:
                poly = json.loads(pj)
            except Exception:
                poly = None

        # PolyJson 沒有就用 P1..P4 回補（避免你 DB 舊資料只有點）
        if poly is None and all(
            r.get(k) is not None for k in ["p1x","p1y","p2x","p2y","p3x","p3y","p4x","p4y"]
        ):
            poly = [
                [float(r["p1x"]), float(r["p1y"])],
                [float(r["p2x"]), float(r["p2y"])],
                [float(r["p3x"]), float(r["p3y"])],
                [float(r["p4x"]), float(r["p4y"])],
            ]

        r["poly"] = poly
        r.pop("polyJson", None)

        # 不回傳 p1..p4（前端主要吃 poly）
        for k in ["p1x","p1y","p2x","p2y","p3x","p3y","p4x","p4y"]:
            r.pop(k, None)

        try:
            r["x_min"], r["y_min"], r["x_max"], r["y_max"] = _normalize_aabb(
                float(r["x_min"]), float(r["y_min"]), float(r["x_max"]), float(r["y_max"])
            )
        except Exception:
            pass

    return rows
