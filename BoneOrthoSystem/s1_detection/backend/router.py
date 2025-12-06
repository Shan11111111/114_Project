# router.py
from fastapi import APIRouter, UploadFile, File
from ultralytics import YOLO
from PIL import Image
import io
from typing import Dict, Any, List

# ⭐⭐ 關鍵：把 db 那邊的工具引進來
from bone_service import get_bone_info, assign_spine_levels


# ==========================================
# 建立 APIRouter（取代原本的 app.xxx）
# ==========================================
router = APIRouter()

# ==========================================
# YOLO Model（這裡是 GalaBone 專屬的）
# ==========================================
MODEL_PATH = "ml/best.pt"
model = YOLO(MODEL_PATH)


# ==========================================
# Health Check
# 會掛在："/"（若 main 沒加 prefix）
# 或 "/gala/"（若 main 用 prefix="/gala"）
# ==========================================
@router.get("/")
async def root():
    return {"message": "GalaBone backend is alive!"}


# ==========================================
# 🔥 /predict：YOLO 物件偵測 + 後處理 + DB 查詢
# 路徑一樣是 /predict（或 /gala/predict，看 main 設定）
# ==========================================
@router.post("/predict")
async def predict(file: UploadFile = File(...)):
    # 讀取上傳影像
    image_bytes = await file.read()
    pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    # YOLO OBB 推論
    results = model.predict(
        pil_image,
        imgsz=1024,
        conf=0.3,
        iou=0.4,
        verbose=False,
    )

    res = results[0]
    obb = res.obb

    # 沒偵測到任何東西
    if obb is None or len(obb) == 0:
        return {"count": 0, "boxes": []}

    # 取出偵測結果
    polys_flat = obb.xyxyxyxyn.tolist()
    confs = obb.conf.tolist()
    clses = obb.cls.tolist()

    boxes: List[Dict[str, Any]] = []

    for i in range(len(confs)):
        flat_poly = polys_flat[i]
        cls_id = int(clses[i])

        # 類別名（從 YOLO model.names 取）
        names = model.names
        if isinstance(names, dict):
            cls_name = names.get(cls_id, f"class_{cls_id}")
        else:
            cls_name = names[cls_id] if 0 <= cls_id < len(names) else f"class_{cls_id}"

        # polygon 座標轉成 [[x, y], [x, y], ...]
        if isinstance(flat_poly[0], (list, tuple)):
            # 已經是 pair 形式
            poly_pairs = [[float(x), float(y)] for x, y in flat_poly]
        else:
            # 是平鋪的一維陣列 → 兩兩一組轉 pair
            poly_pairs = [
                [float(flat_poly[j]), float(flat_poly[j + 1])]
                for j in range(0, len(flat_poly), 2)
            ]

        # ⭐ 查 DB（在 db.py 裡處理名稱對應、翻譯等）
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
    # 🔥 脊椎後處理 sub_label（C3 / T7 等）
    # ===================================
    spine_map = assign_spine_levels(boxes)
    for idx, sub_label in spine_map.items():
        boxes[idx]["sub_label"] = sub_label

    return {
        "count": len(boxes),
        "boxes": boxes,
    }
