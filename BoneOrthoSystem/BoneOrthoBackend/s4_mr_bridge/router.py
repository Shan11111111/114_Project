from __future__ import annotations

from fastapi import APIRouter, File, UploadFile, HTTPException
from typing import Any, Dict, List, Optional, Tuple
import io
import numpy as np
from PIL import Image

# ---- Optional OpenCV (used for auto xray-panel detection) ----
try:
    import cv2  # type: ignore
    HAS_CV2 = True
except Exception:
    HAS_CV2 = False

# ---- Reuse your existing YOLO predictor WITHOUT modifying s1 router ----
# We only import its get_model() and call model.predict() similarly.
try:
    from s1_detection.router import get_model  # uses your existing cached loader
except Exception as e:
    get_model = None  # type: ignore

from db import get_conn  # your existing db helper (SQL Server)

router = APIRouter(prefix="/mr", tags=["s4_mr_bridge"])


# -----------------------------
# 1) Auto-detect xray "panel" (screen/film) in a real-world frame
# -----------------------------
def _order_quad_pts(pts: np.ndarray) -> np.ndarray:
    # pts: (4,2)
    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1).reshape(-1)
    ordered = np.zeros((4, 2), dtype=np.float32)
    ordered[0] = pts[np.argmin(s)]      # top-left
    ordered[2] = pts[np.argmax(s)]      # bottom-right
    ordered[1] = pts[np.argmin(diff)]   # top-right
    ordered[3] = pts[np.argmax(diff)]   # bottom-left
    return ordered


def _perspective_warp(img_bgr: np.ndarray, quad: np.ndarray, out_w: int = 1024) -> Tuple[np.ndarray, Dict[str, Any]]:
    quad = _order_quad_pts(quad.astype(np.float32))
    (tl, tr, br, bl) = quad

    wA = np.linalg.norm(br - bl)
    wB = np.linalg.norm(tr - tl)
    hA = np.linalg.norm(tr - br)
    hB = np.linalg.norm(tl - bl)

    maxW = int(max(wA, wB))
    maxH = int(max(hA, hB))
    if maxW <= 0 or maxH <= 0:
        raise ValueError("Invalid quad sizes")

    # keep aspect, resize to out_w
    scale = out_w / float(maxW)
    dstW = out_w
    dstH = int(maxH * scale)

    dst = np.array([
        [0, 0],
        [dstW - 1, 0],
        [dstW - 1, dstH - 1],
        [0, dstH - 1]
    ], dtype=np.float32)

    M = cv2.getPerspectiveTransform(quad, dst)
    warped = cv2.warpPerspective(img_bgr, M, (dstW, dstH))

    meta = {
        "quad_xy": quad.tolist(),      # quad on original frame
        "warped_size": [dstW, dstH],
    }
    return warped, meta


def detect_xray_panel(img_rgb: np.ndarray) -> Tuple[np.ndarray, Dict[str, Any]]:
    """
    Input: RGB uint8 HxWx3
    Output: cropped/warped RGB + meta describing quad on original frame
    """
    if not HAS_CV2:
        # Fallback: center crop (still no file saving)
        h, w = img_rgb.shape[:2]
        side = int(min(h, w) * 0.8)
        y0 = (h - side) // 2
        x0 = (w - side) // 2
        crop = img_rgb[y0:y0+side, x0:x0+side]
        return crop, {"method": "fallback_center_crop", "quad_xy": None, "warped_size": [side, side]}

    img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)

    # normalize + edge detect
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 50, 150)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)

    cnts, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return img_rgb, {"method": "no_contours", "quad_xy": None, "warped_size": [img_rgb.shape[1], img_rgb.shape[0]]}

    # largest contours first
    cnts = sorted(cnts, key=cv2.contourArea, reverse=True)[:10]

    H, W = img_rgb.shape[:2]
    best_quad = None

    for c in cnts:
        area = cv2.contourArea(c)
        if area < 0.08 * W * H:   # ignore tiny
            continue

        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)

        if len(approx) == 4:
            quad = approx.reshape(4, 2)
            best_quad = quad
            break

    if best_quad is None:
        # If not a quad, use minAreaRect on the largest contour
        c = cnts[0]
        rect = cv2.minAreaRect(c)
        box = cv2.boxPoints(rect)  # 4 points
        best_quad = box.astype(np.float32)

    try:
        warped_bgr, meta = _perspective_warp(img_bgr, best_quad, out_w=1024)
        warped_rgb = cv2.cvtColor(warped_bgr, cv2.COLOR_BGR2RGB)
        meta["method"] = "perspective_warp"
        return warped_rgb, meta
    except Exception:
        return img_rgb, {"method": "warp_failed_use_full", "quad_xy": best_quad.tolist(), "warped_size": [W, H]}


# -----------------------------
# 2) YOLO inference on warped xray
# -----------------------------
def yolo_predict_on_rgb(img_rgb: np.ndarray) -> Dict[str, Any]:
    if get_model is None:
        raise HTTPException(status_code=500, detail="s1_detection.get_model import failed in s4_mr_bridge")

    pil = Image.fromarray(img_rgb).convert("RGB")
    model = get_model()

    results = model.predict(
        pil,
        imgsz=1024,
        conf=0.30,
        iou=0.40,
        verbose=False,
    )
    res = results[0]
    obb = getattr(res, "obb", None)
    if obb is None or len(obb) == 0:
        return {"count": 0, "boxes": []}

    polys_flat = obb.xyxyxyxy.tolist()  # (N,8) in pixel coords for warped image
    confs = obb.conf.tolist()
    clses = obb.cls.tolist()
    names = model.names

    boxes: List[Dict[str, Any]] = []
    for i in range(len(confs)):
        cls_id = int(clses[i])
        cls_name = names.get(cls_id, f"class_{cls_id}") if isinstance(names, dict) else (
            names[cls_id] if 0 <= cls_id < len(names) else f"class_{cls_id}"
        )

        p = polys_flat[i]
        poly = [[float(p[0]), float(p[1])],
                [float(p[2]), float(p[3])],
                [float(p[4]), float(p[5])],
                [float(p[6]), float(p[7])]]

        boxes.append({
            "poly": poly,
            "conf": round(float(confs[i]), 3),
            "cls_id": cls_id,
            "cls_name": cls_name,
        })

    return {"count": len(boxes), "boxes": boxes}


# -----------------------------
# 3) DB: big-class -> meshes + bone info
# -----------------------------
def resolve_bone_info_by_name(cls_name: str) -> Optional[Dict[str, Any]]:
    q = """
    SELECT TOP 1 bone_id, bone_en, bone_zh, bone_region, bone_desc
    FROM dbo.Bone_Info
    WHERE LOWER(bone_en) = LOWER(?) OR LOWER(bone_zh) = LOWER(?)
       OR LOWER(bone_en) LIKE LOWER(?) 
    """
    like = f"%{cls_name}%"
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(q, (cls_name, cls_name, like))
    row = cur.fetchone()
    if not row:
        return None
    return {
        "bone_id": int(row[0]),
        "bone_en": row[1],
        "bone_zh": row[2],
        "bone_region": row[3],
        "bone_desc": row[4],
    }


def get_mesh_names_by_bone_id(bone_id: int, limit_meshes: int = 2000) -> List[str]:
    # bone_id -> small_bone_ids
    q_small = "SELECT small_bone_id FROM bone.Bone_small WHERE bone_id = ?"
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(q_small, (bone_id,))
    small_ids = [int(r[0]) for r in cur.fetchall()]
    if not small_ids:
        return []

    # IN (...) safely with params
    placeholders = ",".join(["?"] * len(small_ids))
    q_mesh = f"""
    SELECT MeshName
    FROM model.BoneMeshMap
    WHERE SmallBoneId IN ({placeholders})
    """
    cur.execute(q_mesh, tuple(small_ids))
    meshes = []
    for r in cur.fetchall():
        if r and r[0]:
            meshes.append(str(r[0]))

    # unique preserve order
    seen = set()
    uniq = []
    for m in meshes:
        if m not in seen:
            seen.add(m)
            uniq.append(m)
        if len(uniq) >= limit_meshes:
            break
    return uniq


@router.post("/predict_frame")
async def predict_frame(file: UploadFile = File(...)) -> Dict[str, Any]:
    """
    Receives a real-world camera frame (JPG/PNG bytes).
    Does NOT save to disk.
    Auto-detects xray panel -> warp -> YOLO -> returns boxes in warped coords.
    """
    img_bytes = await file.read()
    try:
        pil = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid image bytes")

    img_rgb = np.array(pil, dtype=np.uint8)

    xray_rgb, meta = detect_xray_panel(img_rgb)
    yolo = yolo_predict_on_rgb(xray_rgb)

    return {
        "xray_panel": meta,   # quad on original + warped_size + method
        "warped_size": meta.get("warped_size"),
        "count": yolo["count"],
        "boxes": yolo["boxes"],
    }


@router.get("/bone-meshes/{cls_name}")
def bone_meshes(cls_name: str) -> Dict[str, Any]:
    """
    big-class name -> Bone_Info -> Bone_small -> BoneMeshMap -> mesh_names
    """
    bone_info = resolve_bone_info_by_name(cls_name)
    if not bone_info:
        return {"found": False, "cls_name": cls_name, "bone_info": None, "mesh_names": []}

    mesh_names = get_mesh_names_by_bone_id(bone_info["bone_id"])
    return {
        "found": True,
        "cls_name": cls_name,
        "bone_info": bone_info,
        "mesh_names": mesh_names,
    }