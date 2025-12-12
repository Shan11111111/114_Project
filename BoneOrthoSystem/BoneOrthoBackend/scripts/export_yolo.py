import os
from pathlib import Path
from db import query_all

# 設定輸出資料夾
ROOT = Path(__file__).resolve().parent.parent
OUT_IMAGES = ROOT / "datasets" / "yolo_bone" / "images"
OUT_LABELS = ROOT / "datasets" / "yolo_bone" / "labels"

OUT_IMAGES.mkdir(parents=True, exist_ok=True)
OUT_LABELS.mkdir(parents=True, exist_ok=True)

# 1. 把所有有標註的 ImageCase 拉出來
cases_sql = """
SELECT DISTINCT
    ic.ImageCaseId,
    ic.ImagePath,       -- 建議你在 vision.ImageCase 加這欄（相對路徑）
    ic.FileName
FROM vision.ImageCase ic
JOIN vision.ImageAnnotation ia ON ia.ImageCaseId = ic.ImageCaseId
"""

cases = query_all(cases_sql)

# 2. 每張圖輸出一個 .txt
for case in cases:
    case_id = case["ImageCaseId"]
    image_path = case["ImagePath"] or case["FileName"]

    # 這裡假設圖檔已經放在 datasets/yolo_bone/images 下面
    src_img = ROOT / image_path
    dst_img = OUT_IMAGES / src_img.name

    if src_img.exists():
        if not dst_img.exists():
            dst_img.write_bytes(src_img.read_bytes())
    else:
        print(f"[WARN] 找不到圖片：{src_img}")
        continue

    # 查這張圖所有標註（用 SmallBoneId 當 class）
    ann_sql = f"""
    SELECT
        SmallBoneId,
        X_min, Y_min, X_max, Y_max
    FROM vision.ImageAnnotation
    WHERE ImageCaseId = {case_id}
    """
    anns = query_all(ann_sql)

    # YOLO label 檔：一行一個 bbox
    # class x_center y_center w h（全部 0~1）
    label_file = OUT_LABELS / (dst_img.stem + ".txt")
    lines = []
    for a in anns:
        cls = a["SmallBoneId"]   # 如果要用 BoneId 也行
        x_min, y_min = a["X_min"], a["Y_min"]
        x_max, y_max = a["X_max"], a["Y_max"]

        x_c = (x_min + x_max) / 2.0
        y_c = (y_min + y_max) / 2.0
        w = x_max - x_min
        h = y_max - y_min

        lines.append(f"{cls} {x_c:.6f} {y_c:.6f} {w:.6f} {h:.6f}")

    label_file.write_text("\n".join(lines), encoding="utf-8")
    print(f"[OK] {dst_img.name} -> {label_file.name}")
