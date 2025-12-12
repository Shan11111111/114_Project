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
- 使用 vision.ImageCase.BoneImageId 去 join dbo.Bone_Images.image_id
- 優先使用 dbo.Bone_Images.image_path 當路徑：
    * 若是 http:// 或 https:// → 取最後檔名，接在 public/bone_images/
    * 若是 /public/...          → 接在 ROOT/public/...
    * 其他相對/絕對路徑         → 直接當路徑
  若以上都沒找到檔案，再退回 ROOT/public/bone_images/<image_name>
- YOLO 類別用 SmallBoneId
"""

from __future__ import annotations

from pathlib import Path
from shutil import copy2
from urllib.parse import urlparse

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


def resolve_image_path(image_path: str | None, image_name: str | None) -> Path | None:
    """
    根據 Bone_Images 的欄位推出實際檔案位置：

    1. 若 image_path 是網址 (http/https)：
       - 抓最後檔名，接在 ROOT/public/bone_images/<name>
    2. 若 image_path 以 '/public/' 開頭：
       - 接在 ROOT/<image_path 去掉開頭斜線>
    3. 否則：
       - 視為一般路徑，若不是絕對路徑就接在 ROOT 底下
    4. 若上述都找不到檔案，且 image_name 有值：
       - 使用 ROOT/public/bone_images/<image_name>
    """

    if image_path:
        s = str(image_path)

        # 1) URL: http / https
        if s.startswith("http://") or s.startswith("https://"):
            parsed = urlparse(s)
            name = Path(parsed.path).name  # 例如 /test-bone.png -> test-bone.png
            if name:
                p = ROOT / "public" / "bone_images" / name
                if p.exists():
                    return p

        # 2) /public/... -> ROOT/public/...
        if s.startswith("/public/"):
            p = ROOT / s.lstrip("/")  # 去掉前面的 '/'
            if p.exists():
                return p

        # 3) 一般路徑
        p = Path(s)
        if not p.is_absolute():
            p = ROOT / p
        if p.exists():
            return p

    # 4) 備案：用 image_name 當檔名，接在 public/bone_images
    if image_name:
        p = ROOT / "public" / "bone_images" / str(image_name)
        if p.exists():
            return p

    return None


def export_cases() -> None:
    print(f"專案根目錄：{ROOT}")
    print(f"輸出資料夾：{DATA_ROOT}")

    # 1) 找出所有「有標註」的影像案例，並 join 到 Bone_Images
    cases_sql = """
    SELECT DISTINCT
        ic.ImageCaseId       AS image_case_id,
        ic.BoneImageId       AS bone_image_id,
        bi.image_path        AS image_path,
        bi.image_name        AS image_name
    FROM vision.ImageCase ic
    JOIN vision.ImageAnnotation ia
        ON ia.ImageCaseId = ic.ImageCaseId
    JOIN dbo.Bone_Images bi
        ON ic.BoneImageId = bi.image_id
    """
    cases = query_all(cases_sql)

    if not cases:
        print("⚠️ 目前資料庫裡沒有任何標註的 ImageCase。")
        return

    print(f"✅ 找到 {len(cases)} 筆有標註的影像案例。")

    num_images = 0
    num_boxes = 0

    for case in cases:
        case_id = case["image_case_id"]
        image_path = case["image_path"]
        image_name = case["image_name"]

        src_img = resolve_image_path(image_path, image_name)
        if not src_img:
            print(
                f"  [WARN] Case {case_id} 找不到實際圖片檔案 "
                f"(image_path={image_path}, image_name={image_name})，略過。"
            )
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

            # 假設 DB 裡存的是 0~1 normalized 座標
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
