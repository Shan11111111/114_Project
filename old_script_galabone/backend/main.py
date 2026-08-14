from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO
from PIL import Image
import io
import pyodbc
from typing import Optional, Dict, Any, List

# ==========================================
# FastAPI app
# ==========================================
app = FastAPI()

# CORS（先全部開放，方便本機前端連線）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# YOLO OBB 模型
# ==========================================
MODEL_PATH = "ml/best.pt"
model = YOLO(MODEL_PATH)

# ==========================================
# SQL Server 連線設定（請依你的實際環境調整）
# ==========================================
DB_DRIVER = "{ODBC Driver 17 for SQL Server}"
DB_SERVER = "localhost"
DB_DATABASE = "BoneDB"
DB_UID = "sa"
DB_PWD = "123456"  # sa 密碼

def get_connection():
    conn_str = (
        f"DRIVER={DB_DRIVER};"
        f"SERVER={DB_SERVER};"
        f"DATABASE={DB_DATABASE};"
        f"UID={DB_UID};"
        f"PWD={DB_PWD};"
    )
    return pyodbc.connect(conn_str)

def get_bone_info(bone_en: str) -> Optional[Dict[str, Any]]:
    """依英文骨名（bone_en）到 Bone_Info 查資料。"""
    try:
        conn = get_connection()
    except Exception as e:
        print("[DB] connect error:", e)
        return None

    try:
        with conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT TOP 1 bone_id, bone_en, bone_zh, bone_region, bone_desc
                FROM dbo.Bone_Info
                WHERE bone_en = ?
                """,
                bone_en,
            )
            row = cursor.fetchone()
            if not row:
                return None

            return {
                "bone_id": row.bone_id,
                "bone_en": row.bone_en,
                "bone_zh": row.bone_zh,
                "bone_region": row.bone_region,
                "bone_desc": row.bone_desc,
            }
    except Exception as e:
        print("[DB] query error:", e)
        return None

# ==========================================
# 健康檢查
# ==========================================
@app.get("/")
async def root():
    return {"message": "GalaBone backend is alive!"}

# ==========================================
# /predict：接圖片 → YOLO OBB 推論 → 回傳框＋骨頭說明
# ==========================================
@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    """
    接收前端圖片 → YOLO OBB 推論 → 回傳每個偵測框的 poly, conf, cls, bone_info
    """
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
    obb = res.obb  # Oriented Bounding Box

    if obb is None or len(obb) == 0:
        return {"count": 0, "boxes": []}

    # 8 點 polygon（已經 normalized 到 0~1）
    polys_flat: List[Any] = obb.xyxyxyxyn.tolist()
    confs: List[float] = obb.conf.tolist()
    clses: List[float] = obb.cls.tolist()

    boxes = []

    for i in range(len(confs)):
        # ==== 你指定要保留的邏輯 ====
        flat_poly = polys_flat[i]  # 有可能是 [[x1,y1],...[x4,y4]] 或 [x1,y1,...,x4,y4]
        conf = round(float(confs[i]), 3)
        cls_id = int(clses[i])

        # 取得類別名稱（支援 model.names 是 list 或 dict）
        if hasattr(model, "names"):
            names = model.names
            if isinstance(names, dict):
                cls_name = names.get(cls_id, f"class_{cls_id}")
            else:  # list-like
                cls_name = (
                    names[cls_id]
                    if isinstance(cls_id, int) and 0 <= cls_id < len(names)
                    else f"class_{cls_id}"
                )
        else:
            cls_name = f"class_{cls_id}"

        # 轉成 [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
        if flat_poly and isinstance(flat_poly[0], (list, tuple)):
            # 目前實際情況：[[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
            poly_pairs = [[float(x), float(y)] for x, y in flat_poly]
        else:
            # 備用：如果哪天變成 [x1,y1,x2,y2,...,x4,y4]
            poly_pairs = [
                [float(flat_poly[j]), float(flat_poly[j + 1])]
                for j in range(0, len(flat_poly), 2)
            ]
        # ==========================

        bone_info = get_bone_info(cls_name)

        boxes.append(
            {
                "poly": poly_pairs,     # [[x1,y1],...[x4,y4]] (normalized)
                "conf": conf,
                "cls_id": cls_id,
                "cls_name": cls_name,
                "bone_info": bone_info,  # 可能是 None（查不到）
            }
        )

    return {
        "count": len(boxes),
        "boxes": boxes,
    }
