# image_service.py
import os
import uuid
import json
from typing import List, Dict, Any, Optional

from matplotlib.pyplot import box

from db import get_connection


# ==========================================
#  跨主機通用：自動尋找 BoneOrthoSystem 根目錄
# ==========================================
def find_project_root(target_folder="BoneOrthoSystem") -> str:
    """
    從當前檔案一路往上找，直到找到名叫 target_folder 的資料夾。
    無論在 Windows / Linux / macOS / 遠端主機 都能正常運作。
    """
    current_path = os.path.abspath(__file__)

    while True:
        parent = os.path.dirname(current_path)
        if parent == current_path:
            raise RuntimeError(f"❌ 無法找到 {target_folder} 根目錄")

        if os.path.basename(parent) == target_folder:
            return parent

        current_path = parent


# 自動找到 BoneOrthoSystem 的根目錄（跨平台 / 跨主機）
PROJECT_ROOT = find_project_root()

# 最終存圖片的資料夾
DEFAULT_IMAGE_DIR = os.path.join(PROJECT_ROOT, "public", "bone_images")

# 確保資料夾存在
os.makedirs(DEFAULT_IMAGE_DIR, exist_ok=True)

print("📌 IMAGE_SAVE_DIR =", DEFAULT_IMAGE_DIR)


# ========================================================
# (1) 存檔案到本機資料夾 public/bone_images
# ========================================================
def save_file_to_disk(
    image_bytes: bytes,
    original_filename: str,
    save_dir: str = DEFAULT_IMAGE_DIR,
) -> str:
    os.makedirs(save_dir, exist_ok=True)

    ext = os.path.splitext(original_filename)[1] or ".png"
    filename = f"{uuid.uuid4().hex}{ext}"

    full_path = os.path.join(save_dir, filename)

    with open(full_path, "wb") as f:
        f.write(image_bytes)

    # 回傳給 DB 用的相對 URL
    return f"/public/bone_images/{filename}"


# ========================================================
# (2) 寫入 dbo.Bone_Images
# ========================================================
def insert_bone_image(
    image_path: str,
    image_name: str,
    content_type: Optional[str] = None,
    bone_id: Optional[int] = None,
) -> int:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO dbo.Bone_Images (
                bone_id,
                image_name,
                image_path,
                content_type,
                image_data,
                created_at
            )
            OUTPUT INSERTED.image_id
            VALUES (?, ?, ?, ?, NULL, GETDATE())
            """,
            (bone_id, image_name, image_path, content_type),
        )
        new_id = cur.fetchone()[0]
        conn.commit()
        return int(new_id)
    finally:
        conn.close()


# ========================================================
# (3) 寫入 vision.ImageCase
# ========================================================
def insert_image_case(
    bone_image_id: int,
    created_by_user_id: Optional[int] = None,
    source: str = "api_upload",
) -> int:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO vision.ImageCase (
                BoneImageId,
                Source,
                CreatedAt,
                CreatedByUserId
            )
            OUTPUT INSERTED.ImageCaseId
            VALUES (?, ?, GETDATE(), ?)
            """,
            (
                bone_image_id,
                source,
                created_by_user_id,
            ),
        )
        new_id = cur.fetchone()[0]
        conn.commit()
        return int(new_id)
    finally:
        conn.close()

# ========================================================
# (4) 寫入 vision.ImageDetection
#     修正：移除不存在的舊欄位
# ========================================================
def insert_image_detections(
    image_case_id: int,
    boxes: List[Dict[str, Any]],
    created_by_user_id: Optional[int] = None,
) -> None:
    conn = get_connection()
    try:
        cur = conn.cursor()

        for box in boxes:
            poly = box.get("poly") or []
            poly4 = poly[:4] if len(poly) >= 4 else []

            # fallback：沒 poly 就用 0
            xs = [float(p[0]) for p in poly4] if poly4 else [0.0]
            ys = [float(p[1]) for p in poly4] if poly4 else [0.0]

            x1, x2 = float(min(xs)), float(max(xs))
            y1, y2 = float(min(ys)), float(max(ys))

            bone_info = box.get("bone_info") or {}
            bone_id = bone_info.get("bone_id")

            # 如果未來有 small_bone_id，就優先從 box 或 bone_info 取
            small_bone_id = (
                box.get("small_bone_id")
                or bone_info.get("small_bone_id")
            )
            sub_label = box.get("sub_label")
            confidence = float(box.get("conf", 0.0) or 0.0)
            cls_id = box.get("cls_id")
            label41 = int(cls_id) if cls_id is not None else 0

            # poly 存 DB（保持 0~1 normalized）
            poly_json = json.dumps(poly4, ensure_ascii=False) if poly4 else None
            poly_is_norm = 1

            # P1~P4 + 中心點
            if poly4:
                (p1x, p1y), (p2x, p2y), (p3x, p3y), (p4x, p4y) = poly4
                p1x, p1y = float(p1x), float(p1y)
                p2x, p2y = float(p2x), float(p2y)
                p3x, p3y = float(p3x), float(p3y)
                p4x, p4y = float(p4x), float(p4y)
                cx = (p1x + p2x + p3x + p4x) / 4.0
                cy = (p1y + p2y + p3y + p4y) / 4.0
            else:
                p1x = p1y = p2x = p2y = p3x = p3y = p4x = p4y = None
                cx = cy = None

            cur.execute(
                """
                INSERT INTO vision.ImageDetection (
                    ImageCaseId,
                    BoneId,
                    SmallBoneId,
                    SubLabel,
                    Label41,
                    Confidence,
                    X1, Y1, X2, Y2,
                    PolyJson,
                    P1X, P1Y, P2X, P2Y, P3X, P3Y, P4X, P4Y,
                    PolyIsNormalized,
                    Cx, Cy,
                    CreatedAt,
                    CreatedByUserId
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), ?)
                """,
                (
                    image_case_id,
                    bone_id,
                    small_bone_id,
                    sub_label,
                    label41,
                    confidence,
                    x1, y1, x2, y2,
                    poly_json,
                    p1x, p1y, p2x, p2y, p3x, p3y, p4x, p4y,
                    poly_is_norm,
                    cx, cy,
                    created_by_user_id,
                ),
            )

        conn.commit()
    finally:
        conn.close()


# ========================================================
# (5) 一次完成存圖＋三張表
# ========================================================
def save_case_and_detections(
    image_bytes: bytes,
    original_filename: str,
    content_type: Optional[str],
    boxes: List[Dict[str, Any]],
    created_by_user_id: Optional[int] = None,
    source: str = "api_upload",
) -> int:
    # 儲存到 public/bone_images
    image_path = save_file_to_disk(image_bytes, original_filename)

    bone_image_id = insert_bone_image(
        image_path=image_path,
        image_name=original_filename,
        content_type=content_type,
    )

    image_case_id = insert_image_case(
        bone_image_id=bone_image_id,
        created_by_user_id=created_by_user_id,
        source=source,
    )

    insert_image_detections(
        image_case_id=image_case_id,
        boxes=boxes,
        created_by_user_id=created_by_user_id,
    )

    return image_case_id