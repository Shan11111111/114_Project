import uuid
from pathlib import Path
from typing import Dict, Any, List  # ★ 記得把 List 也匯進來

import numpy as np
from ultralytics import YOLO
from PIL import Image, ImageDraw, ImageFont

from .bone_labels import BONE_LABELS_ZH_EN  # ★ 中英骨頭名稱對照表


# ======================================
# 路徑設定
# ======================================

# /app  => .../ai_agent_backend/app
BASE_APP_DIR = Path(__file__).resolve().parent.parent
# 專案根目錄 => .../ai_agent_backend
PROJECT_ROOT = BASE_APP_DIR.parent

# 上傳資料夾（要跟 main.py 的 UPLOAD_DIR 一樣：ai_agent_backend/data/uploads）
UPLOAD_DIR = PROJECT_ROOT / "data" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# 模型路徑：ai_agent_backend/app/models/best.pt
MODEL_PATH = BASE_APP_DIR / "models" / "best.pt"
if not MODEL_PATH.exists():
    raise FileNotFoundError(f"YOLO 模型檔不存在：{MODEL_PATH}")

# 字型路徑：ai_agent_backend/fonts/NotoSansTC-Regular.ttf
FONT_PATH = PROJECT_ROOT / "fonts" / "NotoSansTC-Regular.ttf"

# 固定輸出影像寬度（為了讓框線粗細 / 字體大小看起來一致）
TARGET_WIDTH = 800

# 載入 YOLO 模型
model = YOLO(str(MODEL_PATH))


# ==============================
# 中英骨頭名稱對照
# ==============================
def to_zh_en(name: str) -> str:
    """
    把 YOLO 的英文 class name 轉成「中文 (English)」。
    如果查不到對應，就直接回傳原本英文。
    例如：'tibia' -> '脛骨 (Tibia)'
    """
    key = name.lower().strip()
    return BONE_LABELS_ZH_EN.get(key, name)


# ==============================
# 主功能：分析圖片
# ==============================
def analyze_image(image_url: str) -> Dict[str, Any]:
    """
    傳入圖片 URL（例如：/uploads/xxx.png）
    回傳：
    {
      "boxed_url": "/uploads/xxx_boxed.png",
      "detections": [
        {"bone": "Tibia", "confidence": 0.93, "box": [x1,y1,x2,y2]},
        ...
      ]
    }
    """

    # 1) 找圖片檔案
    img_name = Path(image_url).name
    image_path = UPLOAD_DIR / img_name
    if not image_path.exists():
        raise FileNotFoundError(f"找不到圖片檔案：{image_path}")

    # 2) 讀圖，先統一縮放成固定寬度，再丟給 YOLO
    img = Image.open(image_path).convert("RGB")

    orig_w, orig_h = img.size
    if orig_w != TARGET_WIDTH:
        scale = TARGET_WIDTH / float(orig_w)
        new_h = int(orig_h * scale)
        img = img.resize((TARGET_WIDTH, new_h), Image.Resampling.LANCZOS)

    # 這張 img 會同時給 YOLO 推論 & 畫框，這樣粗細 / 字體就固定
    results = model(np.array(img))[0]

    detections: List[Dict[str, Any]] = []

    # 3) 解析 OBB（旋轉框）或一般 boxes
    obb = getattr(results, "obb", None)

    if obb is not None and len(obb) > 0:
        # xyxyxyxy: 每個框 8 個值 (x1,y1,x2,y2,x3,y3,x4,y4)
        xyxyxyxy = obb.xyxyxyxy.cpu().numpy()
        cls = obb.cls.cpu().numpy()
        conf = obb.conf.cpu().numpy()

        for i in range(len(cls)):
            arr = np.array(xyxyxyxy[i]).reshape(-1)  # 長度 8
            coords = arr.tolist()

            xs = coords[0::2]
            ys = coords[1::2]

            x1, y1, x2, y2 = float(min(xs)), float(min(ys)), float(max(xs)), float(max(ys))

            cid = int(cls[i])
            name_en = str(model.names[cid])
            score = float(conf[i])

            detections.append(
                {
                    "bone": name_en,
                    "confidence": score,
                    "box": [x1, y1, x2, y2],
                }
            )

    elif results.boxes is not None and len(results.boxes) > 0:
        boxes = results.boxes
        for box in boxes:
            # 某些版本 box.cls / box.conf 是 tensor[1]，保險一點處理
            cls_id = int(box.cls[0]) if getattr(box.cls, "__len__", None) else int(box.cls)
            score = float(box.conf[0]) if getattr(box.conf, "__len__", None) else float(box.conf)
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            name_en = str(model.names[cls_id])

            detections.append(
                {
                    "bone": name_en,
                    "confidence": score,
                    "box": [float(x1), float(y1), float(x2), float(y2)],
                }
            )

    # 4) 畫框 + 文字（不再畫文字背景的小紅框）
    draw = ImageDraw.Draw(img)

    # 先準備字型
    try:
        font = ImageFont.truetype(str(FONT_PATH), 20)  # 固定 20px，看起來會比較一致
    except Exception:
        font = ImageFont.load_default()

    if detections:
        for det in detections:
            x1, y1, x2, y2 = det["box"]
            name_en = det["bone"]
            score = det["confidence"]

            # 外框：純紅色，不透明，固定寬度 3
            draw.rectangle([x1, y1, x2, y2], outline=(255, 0, 0), width=3)

            # 標籤文字：中文 (English) + 分數
            label_text = f"{to_zh_en(name_en)} {score:.2f}"

            # 文字直接畫，不再畫背景小方框
            text_pos = (x1 + 4, max(y1 - 24, 0))
            draw.text(text_pos, label_text, fill=(255, 0, 0), font=font)
    else:
        # 沒偵測就留個提示文字
        try:
            font_small = ImageFont.truetype(str(FONT_PATH), 20)
        except Exception:
            font_small = ImageFont.load_default()
        draw.text((10, 10), "GalaBone：這張影像未偵測到特定骨頭。", fill=(255, 0, 0), font=font_small)

    # 5) 存成新的加框圖片
    new_name = f"{uuid.uuid4().hex}_boxed.png"
    save_path = UPLOAD_DIR / new_name
    img.save(save_path)

    boxed_url = f"/uploads/{new_name}"

    return {
        "boxed_url": boxed_url,
        "detections": detections,
    }


# 測試用：直接執行這個檔案可以快速驗證（跑 uvicorn 的時候不會執行）
if __name__ == "__main__":
    # 這裡記得改成 data/uploads 中實際存在的檔名再測
    test_name = "test_image.png"
    print(analyze_image(f"/uploads/{test_name}"))
