# utils/spine_postprocess.py

from typing import List, Dict

# 小類 mapping（可對應你資料庫）
SPINE_LEVELS = {
    "Cervical_Vertebrae": ["C1", "C2", "C3", "C4", "C5", "C6", "C7"],
    "Thoracic_Vertebrae": ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12"],
    "Lumbar_Vertebrae": ["L1", "L2", "L3", "L4", "L5"],
}

def postprocess_spine_levels(dets: List[Dict]) -> List[Dict]:
    """
    針對 YOLO 的脊椎偵測結果，依照上下位置自動貼 C1~C7 / T1~T12 / L1~L5。
    dets: 每一筆偵測是一個 dict，例如：
        {
            "cls_name": "Cervical_Vertebrae",
            "conf": 0.87,
            "bbox": [x1, y1, x2, y2]
        }
    """
    output = []

    for major_name, level_list in SPINE_LEVELS.items():
        subset = [d for d in dets if d["cls_name"] == major_name]
        if not subset:
            continue

        # 依 y-center 由上到下排序
        def y_center(det):
            x1, y1, x2, y2 = det["bbox"]
            return (y1 + y2) / 2.0

        subset_sorted = sorted(subset, key=y_center)
        max_levels = len(level_list)

        for idx, det in enumerate(subset_sorted):
            sub_label = level_list[idx] if idx < max_levels else "unknown"

            # 新增 sub_label 進結果
            new_det = det.copy()
            new_det["sub_label"] = sub_label
            output.append(new_det)

    # 非脊椎類別照原樣加入
    for det in dets:
        if det["cls_name"] not in SPINE_LEVELS:
            output.append(det)

    return output
