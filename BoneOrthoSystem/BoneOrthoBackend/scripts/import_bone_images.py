import os
import mimetypes
from datetime import datetime

import pyodbc


# ========= 請改成你的實際環境 =========
ROOT_DIR = r"C:\Users\IM43LLM\Desktop\114_Project\BoneOrthoSystem\BoneOrthoBackend\data\bone_examples"

DB_CONFIG = {
    "driver": "ODBC Driver 17 for SQL Server",
    "server": "localhost",
    "database": "BoneDB",
    "uid": "sa",
    "pwd": "你的密碼",
}

# 前端 / API 要讀的靜態路徑前綴
DB_PATH_PREFIX = "/data/bone_examples"
# ====================================


FOLDER_TO_BONE_ID = {
    "01_Cervical_Vertebrae_頸椎": 1,
    "02_Thoracic_Vertebrae_胸椎": 2,
    "03_Lumbar_Vertebrae_腰椎": 3,
    "04_Clavicles_鎖骨": 4,
    "05_Scapulae_肩胛骨": 5,
    "06_Humeri_肱骨": 6,
    "07_Ulnae_尺骨": 7,
    "08_Radii_橈骨": 8,
    "09_Carpals_腕骨": 9,
    "10_Metacarpals_掌骨": 10,
    "11_Phalanges_Hand_手部指骨": 11,
    "12_Ribs_肋骨": 12,
    "13_Sternum_胸骨": 13,
    "14_Femora_股骨": 14,
    "15_Tibiae_脛骨": 15,
    "16_Fibulae_腓骨": 16,
}


ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".webp"}


def get_connection():
    conn_str = (
        f"DRIVER={{{DB_CONFIG['driver']}}};"
        f"SERVER={DB_CONFIG['server']};"
        f"DATABASE={DB_CONFIG['database']};"
        f"UID={DB_CONFIG['uid']};"
        f"PWD={DB_CONFIG['pwd']};"
        "TrustServerCertificate=yes;"
    )
    return pyodbc.connect(conn_str)


def is_image_file(filename: str) -> bool:
    ext = os.path.splitext(filename)[1].lower()
    return ext in ALLOWED_EXTENSIONS


def main():
    if not os.path.isdir(ROOT_DIR):
        print(f"[錯誤] 找不到資料夾：{ROOT_DIR}")
        return

    conn = get_connection()
    cursor = conn.cursor()

    inserted = 0
    skipped = 0
    failed = 0

    print(f"開始匯入：{ROOT_DIR}\n")

    for folder_name in os.listdir(ROOT_DIR):
        folder_path = os.path.join(ROOT_DIR, folder_name)

        if not os.path.isdir(folder_path):
            continue

        bone_id = FOLDER_TO_BONE_ID.get(folder_name)
        if bone_id is None:
            print(f"[略過資料夾] 無對應 bone_id：{folder_name}")
            skipped += 1
            continue

        print(f"\n=== 類別資料夾：{folder_name} -> bone_id={bone_id} ===")

        for filename in os.listdir(folder_path):
            file_path = os.path.join(folder_path, filename)

            if not os.path.isfile(file_path):
                continue

            if not is_image_file(filename):
                print(f"[略過非圖片] {filename}")
                skipped += 1
                continue

            content_type, _ = mimetypes.guess_type(file_path)
            if not content_type:
                content_type = "application/octet-stream"

            db_path = f"{DB_PATH_PREFIX}/{folder_name}/{filename}"

            try:
                cursor.execute("""
                    SELECT COUNT(1)
                    FROM dbo.Bone_Images
                    WHERE bone_id = ? AND image_name = ? AND image_path = ?
                """, bone_id, filename, db_path)
                exists = cursor.fetchone()[0]

                if exists:
                    print(f"[略過重複] {db_path}")
                    skipped += 1
                    continue

                cursor.execute("""
                    INSERT INTO dbo.Bone_Images
                    (
                        bone_id,
                        image_name,
                        image_path,
                        content_type,
                        created_at
                    )
                    VALUES (?, ?, ?, ?, ?)
                """, bone_id, filename, db_path, content_type, datetime.now())

                inserted += 1
                print(f"[成功] {db_path}")

            except Exception as e:
                failed += 1
                print(f"[失敗] {db_path} -> {e}")

    conn.commit()
    cursor.close()
    conn.close()

    print("\n===== 匯入完成 =====")
    print(f"成功：{inserted}")
    print(f"略過：{skipped}")
    print(f"失敗：{failed}")


if __name__ == "__main__":
    main()