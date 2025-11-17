from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO
import numpy as np
from PIL import Image
import io

app = FastAPI()

# ==========================================
# CORS（保持全開）
# ==========================================
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# 載入 YOLO OBB 模型 (ml/best.pt)
# ==========================================
MODEL_PATH = "ml/best.pt"
model = YOLO(MODEL_PATH)

@app.get("/")
async def root():
    return {"message": "GalaBone backend is alive!"}

# ==========================================
# 推論 API
# ==========================================
@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    """
    接收前端圖片 → YOLO OBB 推論 → 回傳每個偵測框的 poly, conf, cls
    """
    image_bytes = await file.read()

    # 轉 PIL Image
    pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    # YOLO 模型推論（obb=True 代表要讀出 OBB polygon）
    results = model.predict(pil_image, imgsz=1024, conf=0.3, iou=0.4, verbose=False)

    res = results[0]  # 第 1 張圖片
    obb = res.obb      # 取得 OBB 結果

    # 若沒有偵測到東西
    if obb is None or len(obb) == 0:
        return {"count": 0, "boxes": []}

    # 解析每個框
    boxes = []
    polys = obb.xyxyxyxyn.tolist()  # 8 點 polygon normalized
    confs = obb.conf.tolist()
    clses = obb.cls.tolist()

    for i in range(len(confs)):
        poly = polys[i]              # [x1,y1,x2,y2,...,x4,y4] normalized
        conf = round(confs[i], 3)
        cls_id = int(clses[i])
        cls_name = model.names[cls_id] if hasattr(model, "names") else f"class_{cls_id}"

        boxes.append({
            "poly": poly,
            "conf": conf,
            "cls_id": cls_id,
            "cls_name": cls_name
        })

    return {
        "count": len(boxes),
        "boxes": boxes
    }
