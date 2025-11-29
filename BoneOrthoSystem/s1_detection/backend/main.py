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
# 🔥 脊椎後處理：C1~C7 / T1~T12 / L1~L5
# ==========================================

SPINE_LEVELS = {
    "Cervical_Vertebrae": ["C1", "C2", "C3", "C4", "C5", "C6", "C7"],
    "Thoracic_Vertebrae": ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12"],
    "Lumbar_Vertebrae": ["L1", "L2", "L3", "L4", "L5"],
}

def assign_spine_levels(boxes: List[Dict]) -> Dict[int, str]:
    """
    針對 boxes（已含 poly / cls_name）
    幫頸椎 / 胸椎 / 腰椎自動分配 C3 / T7 / L5 等小類。

    回傳 { index: "C3" } 這種 mapping。
    """
    index_to_sub = {}

    for major_name, level_list in SPINE_LEVELS.items():
        # 找出同一大類的框
        idx_and_boxes = [
            (idx, box)
            for idx, box in enumerate(boxes)
            if box.get("cls_name") == major_name
        ]
        if not idx_and_boxes:
            continue

        # Y 軸中心點（上→下排序）
        def y_center(item):
            _, b = item
            poly = b.get("poly", [])
            if not poly:
                return 0.0
            ys = [p[1] for p in poly]
            return sum(ys) / len(ys)

        idx_and_boxes_sorted = sorted(idx_and_boxes, key=y_center)

        max_levels = len(level_list)
        for i, (idx, b) in enumerate(idx_and_boxes_sorted):
            sub_label = level_list[i] if i < max_levels else "unknown"
            index_to_sub[idx] = sub_label

    return index_to_sub


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
    接收前端圖片 → YOLO OBB 推論 → 回傳每個偵測框的 poly, conf, cls, bone_info, sub_label
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

    polys_flat: List[Any] = obb.xyxyxyxyn.tolist()
    confs: List[float] = obb.conf.tolist()
    clses: List[float] = obb.cls.tolist()

    boxes = []

    for i in range(len(confs)):
        flat_poly = polys_flat[i]
        conf = round(float(confs[i]), 3)
        cls_id = int(clses[i])

        # 類別轉名稱
        if hasattr(model, "names"):
            names = model.names
            if isinstance(names, dict):
                cls_name = names.get(cls_id, f"class_{cls_id}")
            else:
                cls_name = names[cls_id] if 0 <= cls_id < len(names) else f"class_{cls_id}"
        else:
            cls_name = f"class_{cls_id}"

        # polygon
        if flat_poly and isinstance(flat_poly[0], (list, tuple)):
            poly_pairs = [[float(x), float(y)] for x, y in flat_poly]
        else:
            poly_pairs = [
                [float(flat_poly[j]), float(flat_poly[j+1])]
                for j in range(0, len(flat_poly), 2)
            ]

        bone_info = get_bone_info(cls_name)

        boxes.append(
            {
                "poly": poly_pairs,
                "conf": conf,
                "cls_id": cls_id,
                "cls_name": cls_name,
                "bone_info": bone_info,
            }
        )

    # ===================================
    # 🔥 套用脊椎後處理（C/T/L 節數）
    # ===================================
    spine_sub_map = assign_spine_levels(boxes)
    for idx, sub_label in spine_sub_map.items():
        boxes[idx]["sub_label"] = sub_label

    return {
        "count": len(boxes),
        "boxes": boxes,
    }
