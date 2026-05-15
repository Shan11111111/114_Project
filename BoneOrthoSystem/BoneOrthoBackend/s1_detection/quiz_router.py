# s1_detection/quiz_router.py
import random
import json
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, HTTPException, Query
from db import query_one, query_all

router = APIRouter(prefix="/quiz", tags=["quiz"])


def clean_bone_zh(value: Optional[str]) -> str:
    if not value:
        return ""
    return value.replace("（2）", "").replace("(2)", "").strip()


def shuffle_options(correct: str, wrongs: List[str]) -> List[str]:
    options = [correct] + [w for w in wrongs if w and w != correct]
    options = list(dict.fromkeys(options))
    random.shuffle(options)
    return options[:4]


def parse_poly(poly_json: Optional[str]) -> List[List[float]]:
    if not poly_json:
        return []
    try:
        data = json.loads(poly_json)
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and isinstance(data.get("poly"), list):
            return data["poly"]
    except Exception:
        pass
    return []


def get_wrong_bone_options(
    correct_bone_id: int,
    field: str,
    limit: int = 3,
    same_region: Optional[str] = None,
) -> List[str]:
    allowed_fields = {
        "bone_zh": "bone_zh",
        "bone_en": "bone_en",
        "bone_region": "bone_region",
    }

    if field not in allowed_fields:
        return []

    col = allowed_fields[field]

    if same_region and field != "bone_region":
        rows = query_all(
            f"""
            SELECT TOP ({limit}) {col} AS value
            FROM dbo.Bone_Info
            WHERE bone_id <> ?
              AND bone_region = ?
              AND {col} IS NOT NULL
              AND LTRIM(RTRIM({col})) <> ''
            ORDER BY NEWID()
            """,
            [correct_bone_id, same_region],
        )

        if len(rows) >= limit:
            return [r["value"] for r in rows]

    rows = query_all(
        f"""
        SELECT TOP ({limit}) {col} AS value
        FROM dbo.Bone_Info
        WHERE bone_id <> ?
          AND {col} IS NOT NULL
          AND LTRIM(RTRIM({col})) <> ''
        ORDER BY NEWID()
        """,
        [correct_bone_id],
    )

    return [r["value"] for r in rows]


def get_wrong_region_options(correct_region: str, limit: int = 3) -> List[str]:
    rows = query_all(
        """
        SELECT TOP (?) bone_region AS value
        FROM (
            SELECT DISTINCT bone_region
            FROM dbo.Bone_Info
            WHERE bone_region IS NOT NULL
              AND LTRIM(RTRIM(bone_region)) <> ''
              AND bone_region <> ?
        ) AS regions
        ORDER BY NEWID()
        """,
        [limit, correct_region],
    )

    return [r["value"] for r in rows]


def get_spine_options(sub_label: str) -> List[str]:
    sub = sub_label.upper().strip()

    if sub.startswith("C"):
        pool = ["C1", "C2", "C3", "C4", "C5", "C6", "C7"]
    elif sub.startswith("T"):
        pool = [f"T{i}" for i in range(1, 13)]
    elif sub.startswith("L"):
        pool = ["L1", "L2", "L3", "L4", "L5"]
    else:
        pool = ["C1", "C2", "T1", "T2", "L1", "L2"]

    wrongs = [x for x in pool if x != sub]
    random.shuffle(wrongs)
    return shuffle_options(sub, wrongs[:3])


def get_spine_special_question(sub_label: Optional[str]) -> Optional[Dict[str, Any]]:
    if not sub_label:
        return None

    sub = sub_label.upper().strip()

    if sub == "C1":
        correct = "寰椎 Atlas"
        wrongs = ["樞椎 Axis", "胸椎 Thoracic vertebra", "腰椎 Lumbar vertebra"]
        return {
            "type": "spine_level_name",
            "question": "圖中標示的 C1 頸椎又稱為什麼？",
            "correct_answer": correct,
            "options": shuffle_options(correct, wrongs),
            "explanation": "C1 是第一頸椎，又稱寰椎 Atlas。",
        }

    if sub == "C2":
        correct = "樞椎 Axis"
        wrongs = ["寰椎 Atlas", "胸椎 Thoracic vertebra", "腰椎 Lumbar vertebra"]
        return {
            "type": "spine_level_name",
            "question": "圖中標示的 C2 頸椎又稱為什麼？",
            "correct_answer": correct,
            "options": shuffle_options(correct, wrongs),
            "explanation": "C2 是第二頸椎，又稱樞椎 Axis。",
        }

    return {
        "type": "spine_level",
        "question": "圖中高亮的脊椎分節是？",
        "correct_answer": sub,
        "options": get_spine_options(sub),
        "explanation": f"此辨識框目前標示為 {sub}。",
    }


def build_single_bone_questions(
    bone_id: int,
    bone_zh: str,
    bone_en: str,
    bone_region: str,
    bone_desc: Optional[str],
    sub_label: Optional[str] = None,
) -> List[Dict[str, Any]]:
    questions: List[Dict[str, Any]] = []

    wrong_zh = [
        clean_bone_zh(v)
        for v in get_wrong_bone_options(
            correct_bone_id=bone_id,
            field="bone_zh",
            limit=3,
            same_region=bone_region,
        )
    ]

    questions.append({
        "type": "bone_name",
        "question": "圖中高亮的骨骼是？",
        "correct_answer": bone_zh,
        "options": shuffle_options(bone_zh, wrong_zh),
        "explanation": f"圖中辨識到的骨骼為「{bone_zh}」。",
    })

    if bone_en:
        wrong_en = get_wrong_bone_options(
            correct_bone_id=bone_id,
            field="bone_en",
            limit=3,
            same_region=bone_region,
        )

        questions.append({
            "type": "bone_english",
            "question": f"「{bone_zh}」的英文名稱是？",
            "correct_answer": bone_en,
            "options": shuffle_options(bone_en, wrong_en),
            "explanation": f"{bone_zh} 的英文名稱是 {bone_en}。",
        })

    if bone_region:
        wrong_regions = get_wrong_region_options(bone_region, 3)

        questions.append({
            "type": "bone_region",
            "question": f"「{bone_zh}」屬於哪個部位區域？",
            "correct_answer": bone_region,
            "options": shuffle_options(bone_region, wrong_regions),
            "explanation": f"{bone_zh} 屬於 {bone_region}。",
        })

    spine_question = get_spine_special_question(sub_label)
    if spine_question:
        questions.append(spine_question)

    if bone_desc:
        questions.append({
            "type": "bone_description",
            "question": f"下列何者最符合「{bone_zh}」的說明？",
            "correct_answer": bone_desc,
            "options": shuffle_options(
                bone_desc,
                [
                    "主要位於下肢，負責承受身體重量。",
                    "位於胸腔周圍，主要與呼吸運動相關。",
                    "位於手部，負責手指與手掌活動。",
                ],
            ),
            "explanation": bone_desc,
        })

    return questions


@router.get("/generate")
def generate_quiz(
    bone_id: int = Query(...),
    sub_label: Optional[str] = Query(None),
    limit: int = Query(5, ge=3, le=5),
):
    bone = query_one(
        """
        SELECT TOP 1
            bone_id,
            bone_en,
            bone_zh,
            bone_region,
            bone_desc
        FROM dbo.Bone_Info
        WHERE bone_id = ?
        """,
        [bone_id],
    )

    if not bone:
        raise HTTPException(status_code=404, detail="找不到 bone_id 對應的骨骼資料")

    bone_zh = clean_bone_zh(bone.get("bone_zh"))
    bone_en = bone.get("bone_en") or ""
    bone_region = bone.get("bone_region") or ""

    questions = build_single_bone_questions(
        bone_id=bone_id,
        bone_zh=bone_zh,
        bone_en=bone_en,
        bone_region=bone_region,
        bone_desc=bone.get("bone_desc"),
        sub_label=sub_label,
    )

    random.shuffle(questions)

    return {
        "mode": "single_bone",
        "bone_id": bone_id,
        "bone_zh": bone_zh,
        "bone_en": bone_en,
        "bone_region": bone_region,
        "sub_label": sub_label,
        "count": min(limit, len(questions)),
        "questions": questions[:limit],
    }


@router.get("/generate-from-case")
def generate_quiz_from_case(
    image_case_id: int = Query(...),
    limit: int = Query(5, ge=3, le=5),
):
    detections = query_all(
        """
        SELECT
            d.DetectionId,
            d.ImageCaseId,
            d.BoneId,
            d.SmallBoneId,
            d.SubLabel,
            d.Confidence,
            d.PolyJson,

            b.bone_zh,
            b.bone_en,
            b.bone_region,
            b.bone_desc
        FROM vision.ImageDetection AS d
        LEFT JOIN dbo.Bone_Info AS b
            ON d.BoneId = b.bone_id
        WHERE d.ImageCaseId = ?
          AND d.BoneId IS NOT NULL
        ORDER BY d.DetectionId ASC
        """,
        [image_case_id],
    )

    if not detections:
        raise HTTPException(status_code=404, detail="這張圖片沒有可出題的辨識結果")

    random.shuffle(detections)
    selected = detections[:limit]

    questions: List[Dict[str, Any]] = []

    for d in selected:
        bone_id = int(d["BoneId"])
        bone_zh = clean_bone_zh(d.get("bone_zh"))
        bone_en = d.get("bone_en") or ""
        bone_region = d.get("bone_region") or ""
        sub_label = d.get("SubLabel")
        poly = parse_poly(d.get("PolyJson"))

        if sub_label:
            sub = str(sub_label).upper().strip()

            questions.append({
                "type": "case_spine_level",
                "detection_id": d["DetectionId"],
                "bone_id": bone_id,
                "sub_label": sub,
                "poly": poly,
                "question": f"圖中高亮的「{bone_zh}」是第幾節？",
                "correct_answer": sub,
                "options": get_spine_options(sub),
                "explanation": f"此辨識框對應的分節為 {sub}。",
            })

            if sub in ["C1", "C2"]:
                special = get_spine_special_question(sub)
                if special:
                    special["detection_id"] = d["DetectionId"]
                    special["bone_id"] = bone_id
                    special["sub_label"] = sub
                    special["poly"] = poly
                    questions.append(special)

            continue

        wrong_zh = [
            clean_bone_zh(v)
            for v in get_wrong_bone_options(
                correct_bone_id=bone_id,
                field="bone_zh",
                limit=3,
                same_region=bone_region,
            )
        ]

        questions.append({
            "type": "case_bone_name",
            "detection_id": d["DetectionId"],
            "bone_id": bone_id,
            "sub_label": sub_label,
            "poly": poly,
            "question": "圖中高亮的骨骼是？",
            "correct_answer": bone_zh,
            "options": shuffle_options(bone_zh, wrong_zh),
            "explanation": f"此辨識框對應的骨骼為「{bone_zh}」。",
        })

    random.shuffle(questions)
    questions = questions[:limit]

    return {
        "mode": "image_case",
        "image_case_id": image_case_id,
        "count": len(questions),
        "questions": questions,
    }