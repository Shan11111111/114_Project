# image_service.py
import os
import uuid
from typing import List, Dict, Any, Optional

from db import get_connection

# ==========================================
# 圖片儲存設定：BoneOrthoSystem/public/bone_images
# ==========================================

# image_service.py 的路徑：
# BoneOrthoSystem/s1_detection/backend/image_service.py
# 因此 BoneOrthoSystem = dirname(dirname(backend))
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 最終存放路徑：BoneOrthoSystem/public/bone_images
DEFAULT_IMAGE_DIR = os.path.join(PROJECT_ROOT, "public", "bone_images")

print("💾 IMAGE_SAVE_DIR =", DEFAULT_IMAGE_DIR)


# ------------------------------------------
# (1) 把檔案存到伺服器上的某個資料夾
# ------------------------------------------
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

    # 回傳給 DB 用的相對路徑
    return f"/public/bone_images/{filename}"


# ------------------------------------------
# (2) 在 dbo.Bone_Images 新增一筆
# ------------------------------------------
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


# ------------------------------------------
# (3) 在 vision.ImageCase 新增一筆
# ------------------------------------------
def insert_image_case(
    bone_image_id: int,
    user_id: Optional[int] = None,
    source: str = "api_upload",
) -> int:

    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO vision.ImageCase (
                UserId,
                BoneImageId,
                Source,
                CreatedAt
            )
            OUTPUT INSERTED.ImageCaseId
            VALUES (?, ?, ?, GETDATE())
            """,
            (user_id, bone_image_id, source),
        )
        new_id = cur.fetchone()[0]
        conn.commit()
        return int(new_id)
    finally:
        conn.close()


# ------------------------------------------
# (4) 寫入 vision.ImageDetection
# ------------------------------------------
def insert_image_detections(
    image_case_id: int,
    boxes: List[Dict[str, Any]],
) -> None:

    conn = get_connection()
    try:
        cur = conn.cursor()

        for box in boxes:
            poly = box.get("poly", [])
            xs = [p[0] for p in poly] if poly else [0.0]
            ys = [p[1] for p in poly] if poly else [0.0]

            x1, x2 = min(xs), max(xs)
            y1, y2 = min(ys), max(ys)

            bone_info = box.get("bone_info") or {}
            bone_id = bone_info.get("bone_id")

            confidence = float(box.get("conf", 0.0))

            # Label41 = YOLO cls_id（不可為 NULL）
            cls_id = box.get("cls_id")
            label41 = int(cls_id) if cls_id is not None else 0

            # 其餘細節先 None
            small_bone_id = None
            attr206 = None
            side = None
            finger = None
            phalanx = None
            serial_number = None

            cur.execute(
                """
                INSERT INTO vision.ImageDetection (
                    ImageCaseId,
                    BoneId,
                    SmallBoneId,
                    Label41,
                    Attr206,
                    Side,
                    Finger,
                    Phalanx,
                    SerialNumber,
                    Confidence,
                    X1,
                    Y1,
                    X2,
                    Y2,
                    CreatedAt
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE())
                """,
                (
                    image_case_id,
                    bone_id,
                    small_bone_id,
                    label41,
                    attr206,
                    side,
                    finger,
                    phalanx,
                    serial_number,
                    confidence,
                    x1,
                    y1,
                    x2,
                    y2,
                ),
            )

        conn.commit()
    finally:
        conn.close()


# ------------------------------------------
# (5) 一次完成存圖＋寫三張表
# ------------------------------------------
def save_case_and_detections(
    image_bytes: bytes,
    original_filename: str,
    content_type: Optional[str],
    boxes: List[Dict[str, Any]],
    user_id: Optional[int] = None,
    source: str = "api_upload",
) -> int:

    # (1) 存到 BoneOrthoSystem/public/bone_images
    image_path = save_file_to_disk(image_bytes, original_filename)

    # (2) Bone_Images
    bone_image_id = insert_bone_image(
        image_path=image_path,
        image_name=original_filename,
        content_type=content_type,
    )

    # (3) ImageCase
    image_case_id = insert_image_case(
        bone_image_id=bone_image_id,
        user_id=user_id,
        source=source,
    )

    # (4) detections
    insert_image_detections(image_case_id, boxes)

    return image_case_id
