from fastapi import APIRouter, UploadFile, File, HTTPException
from ultralytics import YOLO
from PIL import Image
import io
from pathlib import Path
from typing import Dict, Any, List

from .bone_service import get_bone_info, assign_spine_levels
from .image_service import save_case_and_detections

router = APIRouter(
    tags=["s1_detection"]
)

# 用相對於本檔案的位置找 best.pt
BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "model" / "best.pt"

_model = None  # 懶載入用

def get_model():
    global _model
    if _model is None:
        if not MODEL_PATH.exists():
            raise HTTPException(
                status_code=503,
                detail=f"YOLO model not found: {MODEL_PATH}"
            )
        _model = YOLO(str(MODEL_PATH))
    return _model


@router.post("/predict")
async def predict(file: UploadFile = File(...)):
    image_bytes = await file.read()
    pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    model = get_model()  # ✅ 這裡才載入模型

    results = model.predict(
        pil_image,
        imgsz=1024,
        conf=0.3,
        iou=0.4,
        verbose=False,
    )

    res = results[0]
    obb = getattr(res, "obb", None)

    if obb is None or len(obb) == 0:
        return {"count": 0, "boxes": []}

    polys_flat = obb.xyxyxyxyn.tolist()
    confs = obb.conf.tolist()
    clses = obb.cls.tolist()

    boxes: List[Dict[str, Any]] = []

    names = model.names  # 提前取出
    for i in range(len(confs)):
        flat_poly = polys_flat[i]
        cls_id = int(clses[i])

        if isinstance(names, dict):
            cls_name = names.get(cls_id, f"class_{cls_id}")
        else:
            cls_name = names[cls_id] if 0 <= cls_id < len(names) else f"class_{cls_id}"

        if isinstance(flat_poly[0], (list, tuple)):
            poly_pairs = [[float(x), float(y)] for x, y in flat_poly]
        else:
            poly_pairs = [[float(flat_poly[j]), float(flat_poly[j + 1])]
                          for j in range(0, len(flat_poly), 2)]

        bone_info = get_bone_info(cls_name)

        boxes.append({
            "poly": poly_pairs,
            "conf": round(float(confs[i]), 3),
            "cls_id": cls_id,
            "cls_name": cls_name,
            "bone_info": bone_info,
        })

    spine_map = assign_spine_levels(boxes)
    for idx, sub_label in spine_map.items():
        boxes[idx]["sub_label"] = sub_label

    image_case_id = save_case_and_detections(
        image_bytes=image_bytes,
        original_filename=file.filename,
        content_type=file.content_type,
        boxes=boxes,
        user_id=None,
        source="api_upload",
    )

    return {
        "image_case_id": image_case_id,
        "count": len(boxes),
        "boxes": boxes,
    }
