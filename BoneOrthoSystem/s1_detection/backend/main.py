from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO
from PIL import Image
import io
from typing import Dict, Any, List

# ⭐⭐ 關鍵：把 db 那邊的工具引進來
from db import get_bone_info, assign_spine_levels


# ==========================================
# FastAPI App
# ==========================================
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# YOLO Model
# ==========================================
MODEL_PATH = "ml/best.pt"
model = YOLO(MODEL_PATH)


# ==========================================
# Health Check
# ==========================================
@app.get("/")
async def root():
    return {"message": "GalaBone backend is alive!"}


# ==========================================
# 🔥 /predict：YOLO 物件偵測 + 後處理 + DB 查詢
# ==========================================
@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    image_bytes = await file.read()
    pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    results = model.predict(
        pil_image,
        imgsz=1024,
        conf=0.3,
        iou=0.4,
        verbose=False,
    )

    res = results[0]
    obb = res.obb

    if obb is None or len(obb) == 0:
        return {"count": 0, "boxes": []}

    polys_flat = obb.xyxyxyxyn.tolist()
    confs = obb.conf.tolist()
    clses = obb.cls.tolist()

    boxes: List[Dict[str, Any]] = []

    for i in range(len(confs)):
        flat_poly = polys_flat[i]
        cls_id = int(clses[i])

        # 類別名
        names = model.names
        if isinstance(names, dict):
            cls_name = names.get(cls_id, f"class_{cls_id}")
        else:
            cls_name = names[cls_id] if 0 <= cls_id < len(names) else f"class_{cls_id}"

        # polygon
        if isinstance(flat_poly[0], (list, tuple)):
            poly_pairs = [[float(x), float(y)] for x, y in flat_poly]
        else:
            poly_pairs = [
                [float(flat_poly[j]), float(flat_poly[j + 1])]
                for j in range(0, len(flat_poly), 2)
            ]

        # ⭐ 查 DB（會自動做英文名轉換 → 在 db.py 裡實作）
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

    # ===================================
    # 🔥 加上脊椎後處理 sub_label（如 C3 / T7）
    # ===================================
    spine_map = assign_spine_levels(boxes)
    for idx, sub_label in spine_map.items():
        boxes[idx]["sub_label"] = sub_label

    return {
        "count": len(boxes),
        "boxes": boxes,
    }
