# image_service.py
import os
import uuid
from typing import List, Dict, Any, Optional

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
            # 已到達磁碟根目錄仍找不到
            raise RuntimeError(f"❌ 無法找到 {target_folder} 根目錄")

        # 找目錄名是否吻合
        if os.path.basename(parent) == target_folder:
            return parent

        current_path = parent


# 自動找到 BoneOrthoSystem 的根目錄（跨平台 / 跨主機）
PROJECT_ROOT = find_project_root()

# 最終存圖片的資料夾
DEFAULT_IMAGE_DIR = os.path.join(PROJECT_ROOT, "public", "bone_images")

# 確保資料夾存在（跨主機保證可運作）
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


# ========================================================
# (4) 寫入 vision.ImageDetection
# ========================================================
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
            cls_id = box.get("cls_id")
            label41 = int(cls_id) if cls_id is not None else 0

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
                    None,
                    label41,
                    None,
                    None,
                    None,
                    None,
                    None,
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


# ========================================================
# (5) 一次完成存圖＋三張表
# ========================================================
def save_case_and_detections(
    image_bytes: bytes,
    original_filename: str,
    content_type: Optional[str],
    boxes: List[Dict[str, Any]],
    user_id: Optional[int] = None,
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
        user_id=user_id,
        source=source,
    )

    insert_image_detections(image_case_id, boxes)

    return image_case_id
