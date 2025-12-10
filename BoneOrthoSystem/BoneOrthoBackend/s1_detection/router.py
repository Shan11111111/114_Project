# router.py
from fastapi import APIRouter, UploadFile, File
from ultralytics import YOLO
from PIL import Image
import io
import os
from typing import Dict, Any, List

# 如果 bone_service.py 和 image_service.py 和 router.py 在同一個資料夾：
# 建議加一個 __init__.py 之後，用這種寫法：
from .bone_service import get_bone_info, assign_spine_levels
from .image_service import save_case_and_detections

# 若你暫時沒有用 package，原本的：
# from bone_service import get_bone_info, assign_spine_levels
# from image_service import save_case_and_detections
# 也可以先保留，只要 Python 找得到模組就行。

router = APIRouter()

# 🔁 用相對於本檔案的位置找 best.pt，不再用 "ml/best.pt"
BASE_DIR = os.path.dirname(__file__)
MODEL_PATH = os.path.join(BASE_DIR, "model", "best.pt")

model = YOLO(MODEL_PATH)


@router.post("/predict")
async def predict(file: UploadFile = File(...)):
    # 讀取上傳的影像
    image_bytes = await file.read()
    pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    # 呼叫 YOLO 模型做偵測
    results = model.predict(
        pil_image,
        imgsz=1024,
        conf=0.3,
        iou=0.4,
        verbose=False,
    )

    res = results[0]
    obb = res.obb

    # 沒偵測到東西
    if obb is None or len(obb) == 0:
        return {"count": 0, "boxes": []}

    # 取出多邊形座標 / conf / class
    polys_flat = obb.xyxyxyxyn.tolist()
    confs = obb.conf.tolist()
    clses = obb.cls.tolist()

    boxes: List[Dict[str, Any]] = []

    for i in range(len(confs)):
        flat_poly = polys_flat[i]
        cls_id = int(clses[i])

        # 取類別名稱
        names = model.names
        if isinstance(names, dict):
            cls_name = names.get(cls_id, f"class_{cls_id}")
        else:
            cls_name = names[cls_id] if 0 <= cls_id < len(names) else f"class_{cls_id}"

        # 整理多邊形點
        if isinstance(flat_poly[0], (list, tuple)):
            poly_pairs = [[float(x), float(y)] for x, y in flat_poly]
        else:
            poly_pairs = [
                [float(flat_poly[j]), float(flat_poly[j + 1])]
                for j in range(0, len(flat_poly), 2)
            ]

        # 從資料庫查骨頭資訊
        bone_info = get_bone_info(cls_name)

        boxes.append(
            {
                "poly": poly_pairs,
                "conf": round(float(confs[i]), 3),
                "cls_id": cls_id,
                "cls_name": cls_name,
                "bone_info": bone_info,
            }
        )

    # 依照偵測結果標 C1~C7 / T1~T12 / L1~L5 等子標籤
    spine_map = assign_spine_levels(boxes)
    for idx, sub_label in spine_map.items():
        boxes[idx]["sub_label"] = sub_label

    # ✅ 存整個 case + detections 到 DB
    image_case_id = save_case_and_detections(
        image_bytes=image_bytes,
        original_filename=file.filename,
        content_type=file.content_type,
        boxes=boxes,
        user_id=None,          # 之後登入系統再塞真正 user_id
        source="api_upload",
    )

    return {
        "image_case_id": image_case_id,
        "count": len(boxes),
        "boxes": boxes,
    }
