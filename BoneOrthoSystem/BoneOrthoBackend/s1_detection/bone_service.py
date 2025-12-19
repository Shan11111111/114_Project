# bone_service.py
from typing import Optional, Dict, Any, List

from db import get_connection

# ==========================================
# 🔥 模型 → 資料庫 bone_en 名稱轉換表
# ==========================================
MODEL_TO_DB_BONE_EN: Dict[str, str] = {
    "Cervical_Vertebrae": "Cervical vertebrae",
    "Thoracic_Vertebrae": "Thoracic vertebrae",
    "Lumbar_Vertebrae": "Lumbar vertebrae",
    "Phalanges_Hand": "Phalanges",
    "Lumbar_Vertebrae": "Lumbar vertebrae",
    "Lumbar_Vertebrae": "Lumbar vertebrae",
    # 有需要可以在這裡繼續補
}

# ==========================================
# 🔥 查 DB（自動做英文名轉換）
# ==========================================
def get_bone_info(model_name: str) -> Optional[Dict[str, Any]]:
    """
    model_name = YOLO 的類別名，例如 'Cervical_Vertebrae'
    自動轉換為 DB 格式 'Cervical vertebrae' 再去查 Bone_Info
    """

    # 1️⃣ 優先用手動 mapping
    db_bone_en = MODEL_TO_DB_BONE_EN.get(model_name)

    # 2️⃣ 沒在 mapping 裡 → 自動把 "_" 換成空白
    if not db_bone_en:
        db_bone_en = model_name.replace("_", " ")

    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT TOP 1
                bone_id,
                bone_en,
                bone_zh,
                bone_region,
                bone_desc
            FROM dbo.Bone_Info
            WHERE bone_en = ?
        """, db_bone_en)

        row = cur.fetchone()
        if not row:
            return None

        return {
            "bone_id": row.bone_id,
            "bone_en": row.bone_en,
            "bone_zh": row.bone_zh,
            "bone_region": row.bone_region,
            "bone_desc": row.bone_desc,
        }

    finally:
        conn.close()


# ==========================================
# 🔥 脊椎分節 C1~C7, T1~T12, L1~L5
# ==========================================
SPINE_LEVELS = {
    "Cervical_Vertebrae": ["C1","C2","C3","C4","C5","C6","C7"],
    "Thoracic_Vertebrae": [
        "T1","T2","T3","T4","T5","T6",
        "T7","T8","T9","T10","T11","T12"
    ],
    "Lumbar_Vertebrae": ["L1","L2","L3","L4","L5"],
}

def assign_spine_levels(boxes: List[Dict]) -> Dict[int, str]:
    """
    根據 polygon 的 Y 中心值排序 → 順序對應到 C1~ / T1~ / L1~ 等
    傳回: { index_in_boxes: "T7" } 類似這樣
    """
    index_to_sub: Dict[int, str] = {}

    for major_name, level_list in SPINE_LEVELS.items():
        # 把同一個大類 (Cervical_Vertebrae / Thoracic_Vertebrae ...) 的 box 抓出來
        same_cls = [
            (idx, box)
            for idx, box in enumerate(boxes)
            if box.get("cls_name") == major_name
        ]

        if not same_cls:
            continue

        # polygon 的 y 中心
        def y_center(item):
            _, box = item
            poly = box.get("poly", [])
            ys = [p[1] for p in poly]
            return sum(ys) / len(ys) if ys else 0

        # 由上到下排序（或之後你要反向也可以）
        sorted_cls = sorted(same_cls, key=y_center)

        # 依照排序結果套用 C1~ / T1~ / L1~
        for i, (idx, _) in enumerate(sorted_cls):
            index_to_sub[idx] = level_list[i] if i < len(level_list) else "unknown"

    return index_to_sub
