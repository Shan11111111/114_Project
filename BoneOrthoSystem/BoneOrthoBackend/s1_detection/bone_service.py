from collections import defaultdict
from typing import Optional, Dict, Any, List

from db import get_connection


# ==========================================
# YOLO 類別名稱 → Bone_Info.bone_en
# ==========================================
MODEL_TO_DB_BONE_EN: Dict[str, str] = {
    "Cervical_Vertebrae": "Cervical vertebrae",
    "Thoracic_Vertebrae": "Thoracic vertebrae",
    "Lumbar_Vertebrae": "Lumbar vertebrae",
    "Phalanges_Hand": "Phalanges",
    "Ulna": "Ulnae",
    "Humerus": "Humeri",
    "Radius": "Radii",
    "Femur": "Femora",
    "Tibia": "Tibiae",
    "Fibula": "Fibulae",
    "Scapula": "Scapulae",
    "Clavicle": "Clavicles",
}


def _model_name_to_db_bone_en(model_name: str) -> str:
    """將 YOLO 類別名稱轉成 Bone_Info.bone_en 使用的名稱。"""
    return MODEL_TO_DB_BONE_EN.get(
        model_name,
        model_name.replace("_", " "),
    )


# ==========================================
# 查大類骨骼基本資訊
# ==========================================
def get_bone_info(model_name: str) -> Optional[Dict[str, Any]]:
    db_bone_en = _model_name_to_db_bone_en(model_name)

    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT TOP 1
                bone_id,
                bone_en,
                bone_zh,
                bone_region,
                bone_desc
            FROM dbo.Bone_Info
            WHERE bone_en = ?
            """,
            db_bone_en,
        )

        row = cur.fetchone()
        if not row:
            return None

        return {
            "bone_id": int(row.bone_id),
            "bone_en": row.bone_en,
            "bone_zh": row.bone_zh,
            "bone_region": row.bone_region,
            "bone_desc": row.bone_desc,
        }
    finally:
        conn.close()


# ==========================================
# 查 MR 使用的細部骨骼、Mesh 與教學資料
# ==========================================
def get_mr_bone_group_by_bone_id(
    bone_id: int,
) -> Optional[Dict[str, Any]]:
    """
    依 Bone_Info.bone_id 查詢：
    1. 其下所有細部骨骼
    2. 每個細部骨骼對應的一個或多個 MeshName
    3. vw_S3BoneTeaching 中的教學資訊

    注意：
    BoneMeshMap 主鍵為 SmallBoneId + MeshName，
    因此一個細部骨骼可能對應多個 mesh。
    """

    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT
                t.SmallBoneId,
                t.BoneId,
                t.BoneZh,
                t.BoneEn,
                t.BoneRegion,
                t.BoneDesc,
                t.SmallBoneZh,
                t.SmallBoneEn,
                t.SerialNumber,
                t.Place,
                t.SmallBoneNote,
                t.RegionPath,
                t.ListHint,
                t.IntroText,
                t.StructureFunctionText,
                t.LearningText,
                t.SuggestedQuestions,
                t.SortOrder,
                t.TeachingSource,
                m.MeshName
            FROM model.vw_S3BoneTeaching AS t
            LEFT JOIN model.BoneMeshMap AS m
                ON m.SmallBoneId = t.SmallBoneId
            WHERE t.BoneId = ?
            ORDER BY
                t.SortOrder,
                t.SmallBoneId,
                m.MeshName
            """,
            bone_id,
        )

        rows = cur.fetchall()
        if not rows:
            return None

        group = {
            "bone_id": int(rows[0].BoneId),
            "bone_zh": rows[0].BoneZh,
            "bone_en": rows[0].BoneEn,
            "bone_region": rows[0].BoneRegion,
            "bone_desc": rows[0].BoneDesc,
            "small_bones": [],
        }

        # 同一個 SmallBoneId 可能因多個 MeshName 出現多列
        small_bone_map: Dict[int, Dict[str, Any]] = {}

        for row in rows:
            small_bone_id = int(row.SmallBoneId)

            if small_bone_id not in small_bone_map:
                item = {
                    "small_bone_id": small_bone_id,
                    "small_bone_zh": row.SmallBoneZh,
                    "small_bone_en": row.SmallBoneEn,
                    "serial_number": row.SerialNumber,
                    "place": row.Place,
                    "small_bone_note": row.SmallBoneNote,
                    "region_path": row.RegionPath,
                    "list_hint": row.ListHint,
                    "intro_text": row.IntroText,
                    "structure_function_text": row.StructureFunctionText,
                    "learning_text": row.LearningText,
                    "suggested_questions": row.SuggestedQuestions,
                    "sort_order": row.SortOrder,
                    "teaching_source": row.TeachingSource,
                    "mesh_names": [],
                    "has_3d_model": False,
                }

                small_bone_map[small_bone_id] = item
                group["small_bones"].append(item)

            if row.MeshName:
                mesh_name = str(row.MeshName)

                if mesh_name not in small_bone_map[small_bone_id]["mesh_names"]:
                    small_bone_map[small_bone_id]["mesh_names"].append(
                        mesh_name
                    )

                small_bone_map[small_bone_id]["has_3d_model"] = True

        return group
    finally:
        conn.close()


def get_mr_bone_group(
    model_name: str,
) -> Optional[Dict[str, Any]]:
    """
    YOLO 類別名稱 → Bone_Info → MR 細部骨骼資料。
    """
    bone_info = get_bone_info(model_name)
    if not bone_info:
        return None

    group = get_mr_bone_group_by_bone_id(
        int(bone_info["bone_id"])
    )

    if group:
        return group

    # 即使 Bone_small 尚未建完整，也保留大類資訊
    return {
        **bone_info,
        "small_bones": [],
    }


# ==========================================
# 依脊椎 sub_label 推薦 SmallBoneId
# ==========================================
def find_recommended_small_bone_id(
    mr_group: Optional[Dict[str, Any]],
    sub_label: Optional[str],
) -> Optional[int]:
    """
    例如 sub_label = C3、T7、L4，
    嘗試比對 Bone_small.serial_number 或名稱欄位。

    只負責「推薦」，不能把結果宣稱為醫學級確定標註。
    """
    if not mr_group or not sub_label:
        return None

    target = sub_label.strip().upper()

    for item in mr_group.get("small_bones", []):
        possible_values = [
            item.get("serial_number"),
            item.get("small_bone_en"),
            item.get("small_bone_zh"),
        ]

        for value in possible_values:
            if value and str(value).strip().upper() == target:
                return int(item["small_bone_id"])

    return None


# ==========================================
# 脊椎分節 C1~C7, T1~T12, L1~L5
# ==========================================
SPINE_LEVELS = {
    "Cervical_Vertebrae": [
        "C1", "C2", "C3", "C4", "C5", "C6", "C7"
    ],
    "Thoracic_Vertebrae": [
        "T1", "T2", "T3", "T4", "T5", "T6",
        "T7", "T8", "T9", "T10", "T11", "T12"
    ],
    "Lumbar_Vertebrae": [
        "L1", "L2", "L3", "L4", "L5"
    ],
}


def assign_spine_levels(
    boxes: List[Dict[str, Any]],
) -> Dict[int, str]:
    """
    依同類脊椎框的 polygon Y 中心，由上到下排序後分配節數。

    重要限制：
    這個演算法只在影像包含完整或接近完整的脊椎區段時較可信。
    若影像只拍到部分椎體，例如只出現 C3～C7，排序第一個仍可能
    被標成 C1。因此 sub_label 應視為「推定標籤」，不宜直接視為
    ground truth。
    """
    index_to_sub: Dict[int, str] = {}

    for major_name, level_list in SPINE_LEVELS.items():
        same_cls = [
            (idx, box)
            for idx, box in enumerate(boxes)
            if box.get("cls_name") == major_name
        ]

        if not same_cls:
            continue

        def y_center(item):
            _, box = item
            poly = box.get("poly", [])
            ys = [
                float(point[1])
                for point in poly
                if len(point) >= 2
            ]
            return sum(ys) / len(ys) if ys else 0.0

        sorted_cls = sorted(same_cls, key=y_center)

        for i, (idx, _) in enumerate(sorted_cls):
            index_to_sub[idx] = (
                level_list[i]
                if i < len(level_list)
                else "unknown"
            )

    return index_to_sub