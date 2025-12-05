# app/tools/yolo_tool.py
from pathlib import Path
from typing import Dict, Any, List
import uuid
import re

import numpy as np
from ultralytics import YOLO
from PIL import Image, ImageDraw, ImageFont

from shared.db import get_bone_zh_en_by_en

# ======================================
# 路徑設定
# ======================================

BASE_APP_DIR = Path(__file__).resolve().parent.parent  # .../ai_agent_backend/app
PROJECT_ROOT = BASE_APP_DIR.parent                     # .../ai_agent_backend

# 上傳資料夾（要跟 main.py 的 UPLOAD_DIR 一樣）
UPLOAD_DIR = PROJECT_ROOT / "data" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# 模型
MODEL_PATH = BASE_APP_DIR / "models" / "best.pt"
if not MODEL_PATH.exists():
    raise FileNotFoundError(f"YOLO 模型檔不存在：{MODEL_PATH}")

# 字型
FONT_PATH = PROJECT_ROOT / "fonts" / "NotoSansTC-Regular.ttf"

# 固定輸出寬度
TARGET_WIDTH = 800

# 載入 YOLO 模型
model = YOLO(str(MODEL_PATH))


# ======================================
# 資料庫名稱查詢 & 顯示格式
# ======================================

def _clean_zh_name(zh: str) -> str:
    """
    把『肋骨 (24)』這種中文名稱，去掉最後面 '(數字)' 的部分。
    例如：
      '肋骨 (24)' -> '肋骨'
      '腕骨 (16)' -> '腕骨'
    """
    if not zh:
        return zh
    # 去掉結尾的 (數字)
    zh = re.sub(r"\s*\(\d+\)\s*$", "", zh)
    return zh.strip()


def get_bone_label_for_display(yolo_name: str) -> str:
    """
    給 YOLO 的英文類別名稱，回傳要顯示在畫面上的「中文(英文)」。

    如果資料庫查不到，就直接回傳原本英文。
    """
    zh, en_db = get_bone_zh_en_by_en(yolo_name)

    if zh and en_db:
        zh_clean = _clean_zh_name(zh)
        label = f"{zh_clean}({en_db})"
        print(f"[DB-LOOKUP] {yolo_name} => {label}")
        return label
    else:
        print(f"[DB-LOOKUP] {yolo_name} => NOT FOUND, use original")
        # 這裡維持原本 YOLO 類別名稱（例如 'Tibia'）
        return yolo_name


# ======================================
# 主功能：分析圖片
# ======================================

def analyze_image(image_url: str) -> Dict[str, Any]:
    """
    傳入圖片 URL（例如：/uploads/xxx.png）
    回傳：
    {
      "boxed_url": "/uploads/xxx_boxed.png",
      "detections": [
        {"bone": "肋骨(Ribs)", "confidence": 0.93, "box": [x1,y1,x2,y2]},
        ...
      ]
    }
    """

    # 1) 找圖片檔案
    img_name = Path(image_url).name
    image_path = UPLOAD_DIR / img_name
    if not image_path.exists():
        raise FileNotFoundError(f"找不到圖片檔案：{image_path}")

    # 2) 讀圖並縮放
    img = Image.open(image_path).convert("RGB")
    orig_w, orig_h = img.size
    if orig_w != TARGET_WIDTH:
        scale = TARGET_WIDTH / float(orig_w)
        new_h = int(orig_h * scale)
        img = img.resize((TARGET_WIDTH, new_h), Image.Resampling.LANCZOS)

    # 3) YOLO 推論
    results = model(np.array(img))[0]
    detections: List[Dict[str, Any]] = []

    obb = getattr(results, "obb", None)

    if obb is not None and len(obb) > 0:
        # 旋轉框
        xyxyxyxy = obb.xyxyxyxy.cpu().numpy()
        cls = obb.cls.cpu().numpy()
        conf = obb.conf.cpu().numpy()

        for i in range(len(cls)):
            arr = np.array(xyxyxyxy[i]).reshape(-1)  # 8 個座標
            coords = arr.tolist()

            xs = coords[0::2]
            ys = coords[1::2]

            x1, y1, x2, y2 = float(min(xs)), float(min(ys)), float(max(xs)), float(max(ys))

            cid = int(cls[i])
            name_en = str(model.names[cid])
            score = float(conf[i])

            display_name = get_bone_label_for_display(name_en)

            detections.append(
                {
                    "bone": display_name,
                    "confidence": score,
                    "box": [x1, y1, x2, y2],
                }
            )

    elif results.boxes is not None and len(results.boxes) > 0:
        # 一般框
        boxes = results.boxes
        for box in boxes:
            cls_id = int(box.cls[0]) if getattr(box.cls, "__len__", None) else int(box.cls)
            score = float(box.conf[0]) if getattr(box.conf, "__len__", None) else float(box.conf)
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            name_en = str(model.names[cls_id])

            display_name = get_bone_label_for_display(name_en)

            detections.append(
                {
                    "bone": display_name,
                    "confidence": score,
                    "box": [float(x1), float(y1), float(x2), float(y2)],
                }
            )

    # 4) 畫框 + 文字
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype(str(FONT_PATH), 20)
    except Exception:
        font = ImageFont.load_default()

    if detections:
        for det in detections:
            x1, y1, x2, y2 = det["box"]
            display_name = det["bone"]
            score = det["confidence"]

            # 紅框
            draw.rectangle([x1, y1, x2, y2], outline=(255, 0, 0), width=3)

            # 中文(英文) + 分數
            label_text = f"{display_name} {score:.2f}"

            text_pos = (x1 + 4, max(y1 - 24, 0))
            draw.text(text_pos, label_text, fill=(255, 0, 0), font=font)
    else:
        # 沒偵測到骨頭
        try:
            font_small = ImageFont.truetype(str(FONT_PATH), 20)
        except Exception:
            font_small = ImageFont.load_default()
        draw.text(
            (10, 10),
            "Dr.Bone：這張影像未偵測到特定骨頭。",
            fill=(255, 0, 0),
            font=font_small,
        )

    # 5) 存成新的加框圖片
    new_name = f"{uuid.uuid4().hex}_boxed.png"
    save_path = UPLOAD_DIR / new_name
    img.save(save_path)

    boxed_url = f"/uploads/{new_name}"

    return {
        "boxed_url": boxed_url,
        "detections": detections,
    }


if __name__ == "__main__":
    test_name = "test_image.png"
    print(analyze_image(f"/uploads/{test_name}"))
