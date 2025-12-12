"""
s0_annotation/export_yolo.py

把 S0 標註結果 (vision.ImageAnnotation) 匯出成 YOLO 格式的訓練資料集。

執行方式（在 BoneOrthoBackend 根目錄）：

    py -m s0_annotation.export_yolo

輸出路徑：

    BoneOrthoBackend/datasets/s0_yolo/
      ├─ images/   影像檔
      └─ labels/   YOLO txt (class x_center y_center w h)

說明：
- 不再假設有 ImagePath 欄位，而是把 vision.ImageCase 的所有欄位抓出來，
  在 Python 裡面找一個「像檔名／路徑」的欄位（ImagePath / FileName / ImageFileName...）。
- 找到的是純檔名時，就幫你接成 public/bone_images/<檔名>。
- YOLO 類別用 SmallBoneId。
"""

from __future__ import annotations

from pathlib import Path
from shutil import copy2
from typing import Any, Dict

from db import query_all

# === 路徑設定 ===

# 專案根目錄（BoneOrthoBackend）
ROOT = Path(__file__).resolve().parents[1]

# 輸出資料集根目錄
DATA_ROOT = ROOT / "datasets" / "s0_yolo"
IMG_OUT = DATA_ROOT / "images"
LBL_OUT = DATA_ROOT / "labels"

IMG_OUT.mkdir(parents=True, exist_ok=True)
LBL_OUT.mkdir(parents=True, exist_ok=True)


# 嘗試從一列 ImageCase 資料中，找出代表圖片路徑 / 檔名的欄位
def pick_image_field(row: Dict[str, Any]) -> str | None:
  """
  依序嘗試這些欄位：
  - ImagePath / image_path
  - FilePath / file_path
  - ImageFileName / imageFileName
  - FileName / fileName
  找到第一個非空字串就用。
  """
  candidates = [
    "ImagePath",
    "image_path",
    "FilePath",
    "file_path",
    "ImageFileName",
    "imageFileName",
    "FileName",
    "fileName",
  ]
  for key in candidates:
    if key in row and row[key]:
      return str(row[key])
  return None


def export_cases() -> None:
  print(f"專案根目錄：{ROOT}")
  print(f"輸出資料夾：{DATA_ROOT}")

  # 1) 找出所有「有標註」的影像案例
  # 不直接寫欄位名，避免像剛剛 'ImagePath' 那種錯
  cases_sql = """
  SELECT DISTINCT
      ic.ImageCaseId AS image_case_id,
      ic.*
  FROM vision.ImageCase ic
  JOIN vision.ImageAnnotation ia
      ON ia.ImageCaseId = ic.ImageCaseId
  """
  cases = query_all(cases_sql)

  if not cases:
    print("⚠️ 目前資料庫裡沒有任何標註的 ImageCase。")
    return

  print(f"✅ 找到 {len(cases)} 筆有標註的影像案例。")

  num_images = 0
  num_boxes = 0

  for case in cases:
    # pyodbc 回傳本來就是類 dict，但這裡保險轉一下
    row = dict(case)
    case_id = row["image_case_id"]

    img_field = pick_image_field(row)
    if not img_field:
      print(
        f"  [WARN] Case {case_id} 找不到圖片欄位 "
        f"(欄位有：{', '.join(row.keys())})，略過。"
      )
      continue

    # 判斷這個欄位是「含路徑」還是只有檔名
    # 如果裡面有斜線，就當成相對路徑；否則當檔名接在 public/bone_images 底下
    if "/" in img_field or "\\" in img_field:
      src_img = ROOT / img_field
    else:
      # ⭐ 這裡用的是你現在實際放圖片的路徑：public/bone_images/<檔名>
      src_img = ROOT / "public" / "bone_images" / img_field

    if not src_img.exists():
      print(f"  [WARN] 找不到圖片檔案：{src_img}（Case {case_id}），略過。")
      continue

    # 複製到 datasets/s0_yolo/images 底下
    dst_img = IMG_OUT / src_img.name
    if not dst_img.exists():
      copy2(src_img, dst_img)

    # 2) 拉出這張圖的所有標註
    ann_sql = f"""
    SELECT
        SmallBoneId,
        X_min, Y_min, X_max, Y_max
    FROM vision.ImageAnnotation
    WHERE ImageCaseId = {case_id}
      AND SmallBoneId IS NOT NULL
    """
    anns = query_all(ann_sql)

    if not anns:
      print(f"  [INFO] Case {case_id} 沒有 SmallBoneId 標註，略過。")
      continue

    # 3) 輸出 YOLO label 檔
    label_file = LBL_OUT / (dst_img.stem + ".txt")
    lines: list[str] = []

    for a in anns:
      cls = int(a["SmallBoneId"])

      x_min = float(a["X_min"])
      y_min = float(a["Y_min"])
      x_max = float(a["X_max"])
      y_max = float(a["Y_max"])

      # 這裡假設資料庫裡存的是 0~1 normalized 座標
      # 如果之後改成像素座標，這裡要再除以影像寬高。
      x_c = (x_min + x_max) / 2.0
      y_c = (y_min + y_max) / 2.0
      w = x_max - x_min
      h = y_max - y_min

      def clamp(v: float) -> float:
        return max(0.0, min(1.0, v))

      x_c = clamp(x_c)
      y_c = clamp(y_c)
      w = clamp(w)
      h = clamp(h)

      lines.append(f"{cls} {x_c:.6f} {y_c:.6f} {w:.6f} {h:.6f}")
      num_boxes += 1

    label_file.write_text("\n".join(lines), encoding="utf-8")
    num_images += 1
    print(f"  [OK] Case {case_id} -> {dst_img.name}, {len(anns)} 個標註")

  print()
  print("=== 匯出完成 ===")
  print(f"輸出影像數量：{num_images}")
  print(f"輸出標註框數量：{num_boxes}")
  print(f"影像路徑：{IMG_OUT}")
  print(f"標註路徑：{LBL_OUT}")
  print("接下來在 YOLO data.yaml 裡，把 train/val 指到這兩個資料夾即可。")


if __name__ == "__main__":
  export_cases()
