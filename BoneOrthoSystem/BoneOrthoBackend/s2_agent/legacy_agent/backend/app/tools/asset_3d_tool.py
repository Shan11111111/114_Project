# s2_agent/legacy_agent/backend/app/tools/asset_3d_tool.py

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

from fastapi import params
from polars import sql

# C:\Users\IM43LLM\Desktop\114_Project\BoneOrthoSystem\frontend\public\models\bones.glb
MODEL_FILE_PATH = "/models/bones.glb"


def _find_backend_root() -> Path:
    p = Path(__file__).resolve()
    for _ in range(30):
        if (p / "db.py").exists():
            return p
        p = p.parent
    return Path(__file__).resolve().parents[5]


BACKEND_ROOT = _find_backend_root()
if str(BACKEND_ROOT) not in sys.path:
    sys.path.append(str(BACKEND_ROOT))

from db import get_connection  # noqa: E402


def _row_to_dict(cur, row) -> dict[str, Any]:
    cols = [c[0] for c in cur.description]
    return {cols[i]: row[i] for i in range(len(cols))}


def _detect_side(question: str) -> str | None:
    q = question or ""

    if any(k in q for k in ["左", "左側", "left", "Left", ".L", "_L"]):
        return "Left"

    if any(k in q for k in ["右", "右側", "right", "Right", ".R", "_R"]):
        return "Right"

    return None


LESION_KEYWORDS = {
    "fracture": {
        "zh": "骨折示意",
        "keywords": ["骨折", "折斷", "斷裂", "裂痕", "裂開", "破裂"],
        "marks": ["red_overlay", "crack_line", "outline", "leader_label"],
    },
    "tumor": {
        "zh": "腫瘤／病灶示意",
        "keywords": ["腫瘤", "腫塊", "病灶", "癌", "轉移"],
        "marks": ["purple_overlay", "outline", "leader_label"],
    },
    "inflammation": {
        "zh": "發炎示意",
        "keywords": ["發炎", "感染", "腫脹", "疼痛"],
        "marks": ["orange_overlay", "outline", "leader_label"],
    },
    "degeneration": {
        "zh": "退化示意",
        "keywords": ["退化", "磨損", "骨刺", "關節退化"],
        "marks": ["yellow_overlay", "rough_surface", "leader_label"],
    },
    "implant": {
        "zh": "植入物／固定物示意",
        "keywords": ["鋼釘", "鋼板", "植入物", "固定", "手術"],
        "marks": ["metal_marker", "leader_label"],
    },
    "highlight": {
        "zh": "部位標示",
        "keywords": [],
        "marks": ["blue_overlay", "outline", "leader_label"],
    },
}

REGION_ALIAS = {
    "鼻子": ["鼻骨", "下鼻甲", "篩骨", "上頜骨"],
    "鼻腔": ["鼻骨", "下鼻甲", "篩骨"],
    "眼眶": ["顴骨", "淚骨", "篩骨", "上頜骨"],
    "手腕": ["腕骨", "舟狀骨", "月狀骨", "三角骨"],
    "手肘": ["肱骨", "尺骨", "橈骨"],
    "膝蓋": ["股骨", "脛骨", "髕骨"],
    "大腿": ["股骨"],
    "小腿": ["脛骨", "腓骨"],

    # ✅ 新增：脊椎群組
    "頸椎": ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "Cervical vertebrae"],
    "胸椎": ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12", "Thoracic vertebrae"],
    "腰椎": ["L1", "L2", "L3", "L4", "L5", "Lumbar vertebrae"],
    "脊椎": ["頸椎", "胸椎", "腰椎", "Cervical vertebrae", "Thoracic vertebrae", "Lumbar vertebrae"],
}


def detect_lesion_type(question: str) -> dict:
    q = question or ""
    for key, cfg in LESION_KEYWORDS.items():
        if key == "highlight":
            continue
        if any(k in q for k in cfg["keywords"]):
            return {
                "lesion_type": key,
                "lesion_zh": cfg["zh"],
                "visual_marks": cfg["marks"],
            }

    return {
        "lesion_type": "highlight",
        "lesion_zh": LESION_KEYWORDS["highlight"]["zh"],
        "visual_marks": LESION_KEYWORDS["highlight"]["marks"],
    }


def expand_query(question: str) -> str:
    q = question or ""
    for k, bones in REGION_ALIAS.items():
        if k in q:
            q += " " + " ".join(bones)
    return q


def _normalize_text(v: str) -> str:
    """
    Third_Distal.R / Third Distal.R / ThirdDistalR
    都壓成 thirddistalr，給模糊比對用。
    """
    return re.sub(r"[\s_\-\.]+", "", str(v or "")).lower()


def _query_terms(question: str) -> list[str]:
    q = str(question or "").strip()
    q_lower = q.lower()

    terms: list[str] = []

    def add(x: str):
        x = str(x or "").strip()
        if x and x not in terms:
            terms.append(x)

    add(q)

    # 指 / 趾互換
    if "指" in q:
        add(q.replace("指", "趾"))
    if "趾" in q:
        add(q.replace("趾", "指"))

    # 序號
    if any(k in q for k in ["第一", "第1", "拇指", "拇趾"]) or any(
        k in q_lower for k in ["first", "thumb", "big toe", "1st"]
    ):
        add("第一")
        add("拇")
        add("first")
        add("thumb")

    if any(k in q for k in ["第二", "第2"]) or any(
        k in q_lower for k in ["second", "2nd"]
    ):
        add("第二")
        add("second")

    if any(k in q for k in ["第三", "第3"]) or any(
        k in q_lower for k in ["third", "3rd"]
    ):
        add("第三")
        add("third")

    if any(k in q for k in ["第四", "第4"]) or any(
        k in q_lower for k in ["fourth", "4th"]
    ):
        add("第四")
        add("fourth")

    if any(k in q for k in ["第五", "第5", "小指", "小趾"]) or any(
        k in q_lower for k in ["fifth", "little", "5th"]
    ):
        add("第五")
        add("小指")
        add("小趾")
        add("fifth")
        add("little")

    # 節段
    if "遠節" in q or "遠端" in q or "distal" in q_lower:
        add("遠節")
        add("Distal")
        add("distal")

    if "近節" in q or "近端" in q or "proximal" in q_lower:
        add("近節")
        add("Proximal")
        add("proximal")

    if "中節" in q or "中間" in q or "middle" in q_lower:
        add("中節")
        add("Middle")
        add("middle")

    # 類型
    if "趾" in q or "toe" in q_lower:
        add("趾")
        add("toe")
        add("Phalanges")
        add("phalanx")

    if "指" in q or "finger" in q_lower:
        add("指")
        add("finger")
        add("Phalanges")
        add("phalanx")
        
        # ✅ 脊椎：頸椎 C1~C7、胸椎 T1~T12、腰椎 L1~L5
    if "頸椎" in q or "頸部脊椎" in q or "cervical" in q_lower:
        add("頸椎")
        add("Cervical vertebra")
        add("Cervical vertebrae")
        for i in range(1, 8):
            add(f"C{i}")

    if "胸椎" in q or "胸部脊椎" in q or "thoracic" in q_lower:
        add("胸椎")
        add("Thoracic vertebra")
        add("Thoracic vertebrae")
        for i in range(1, 13):
            add(f"T{i}")

    if "腰椎" in q or "腰部脊椎" in q or "lumbar" in q_lower:
        add("腰椎")
        add("Lumbar vertebra")
        add("Lumbar vertebrae")
        for i in range(1, 6):
            add(f"L{i}")

    # ✅ 精準 C7 / T12 / L5
    m = re.search(r"\b([CTLctl])\s*[-_ ]?\s*(\d{1,2})\b", q)
    if m:
        add(f"{m.group(1).upper()}{int(m.group(2))}")

    # ✅ 中文「第七頸椎」「第十二胸椎」「第五腰椎」
    zh_num_map = {
        "一": 1,
        "二": 2,
        "三": 3,
        "四": 4,
        "五": 5,
        "六": 6,
        "七": 7,
        "八": 8,
        "九": 9,
        "十": 10,
        "十一": 11,
        "十二": 12,
    }

    zh = re.search(r"第(十一|十二|十|一|二|三|四|五|六|七|八|九|\d{1,2})(頸椎|胸椎|腰椎)", q)
    if zh:
        raw_no = zh.group(1)
        group_zh = zh.group(2)
        no = int(raw_no) if raw_no.isdigit() else zh_num_map.get(raw_no, 0)

        prefix = ""
        if group_zh == "頸椎":
            prefix = "C"
        elif group_zh == "胸椎":
            prefix = "T"
        elif group_zh == "腰椎":
            prefix = "L"

        if prefix and no:
            add(f"{prefix}{no}")

    return terms

def _detect_vertebra_target(question: str) -> tuple[str, int | None]:
    """
    回傳：
    ("C", 7) 代表第七頸椎 / C7
    ("T", None) 代表只問胸椎群組
    ("", None) 代表不是脊椎問題
    """
    q = str(question or "")
    q_lower = q.lower()

    direct = re.search(r"\b([CTLctl])\s*[-_ ]?\s*(\d{1,2})\b", q)
    if direct:
        return direct.group(1).upper(), int(direct.group(2))

    zh_num_map = {
        "一": 1,
        "二": 2,
        "三": 3,
        "四": 4,
        "五": 5,
        "六": 6,
        "七": 7,
        "八": 8,
        "九": 9,
        "十": 10,
        "十一": 11,
        "十二": 12,
    }

    zh = re.search(r"第(十一|十二|十|一|二|三|四|五|六|七|八|九|\d{1,2})(頸椎|胸椎|腰椎)", q)
    if zh:
        raw_no = zh.group(1)
        group_zh = zh.group(2)
        no = int(raw_no) if raw_no.isdigit() else zh_num_map.get(raw_no)

        if group_zh == "頸椎":
            return "C", no
        if group_zh == "胸椎":
            return "T", no
        if group_zh == "腰椎":
            return "L", no

    if "頸椎" in q or "頸部脊椎" in q or "cervical" in q_lower:
        return "C", None

    if "胸椎" in q or "胸部脊椎" in q or "thoracic" in q_lower:
        return "T", None

    if "腰椎" in q or "腰部脊椎" in q or "lumbar" in q_lower:
        return "L", None

    return "", None


def _parse_vertebra_mesh(mesh_name: str) -> tuple[str, int | None]:
    """
    C7 -> ("C", 7)
    T12 -> ("T", 12)
    L5 -> ("L", 5)
    """
    mesh = str(mesh_name or "").strip()
    m = re.match(r"^([CTLctl])(\d{1,2})$", mesh)
    if not m:
        return "", None
    return m.group(1).upper(), int(m.group(2))

def _rank_asset(row: dict[str, Any], question: str, preferred_side: str | None = None) -> int:
    q = str(question or "")
    q_lower = q.lower()

    mesh = str(row.get("mesh_name") or "")
    mesh_lower = mesh.lower()

    zh = str(row.get("bone_zh") or "")
    en = str(row.get("bone_en") or "")
    place = str(row.get("place") or "")
    all_text = f"{zh} {en} {mesh} {place}".lower()

    score = 0

    # 完整名稱命中
    if zh and zh in q:
        score += 100
    if en and en.lower() in q_lower:
        score += 80
    if mesh and _normalize_text(mesh) in _normalize_text(q):
        score += 90
        
        # ✅ 脊椎 C/T/L 精準與群組加權
    target_group, target_no = _detect_vertebra_target(q)
    mesh_group, mesh_no = _parse_vertebra_mesh(mesh)

    if target_group and mesh_group:
        if target_group == mesh_group:
            score += 90

            # 有指定 C7/T12/L5，精準命中加很多
            if target_no is not None:
                if mesh_no == target_no:
                    score += 180
                else:
                    score -= 120
        else:
            score -= 80

    # 序號
    if any(k in q for k in ["第三", "第3"]) or any(k in q_lower for k in ["third", "3rd"]):
        score += 60 if ("第三" in zh or "third" in all_text or "3rd" in all_text) else -60

    if any(k in q for k in ["第二", "第2"]) or any(k in q_lower for k in ["second", "2nd"]):
        score += 60 if ("第二" in zh or "second" in all_text or "2nd" in all_text) else -60

    if any(k in q for k in ["第四", "第4"]) or any(k in q_lower for k in ["fourth", "4th"]):
        score += 60 if ("第四" in zh or "fourth" in all_text or "4th" in all_text) else -60

    if any(k in q for k in ["第五", "第5", "小指", "小趾"]) or any(
        k in q_lower for k in ["fifth", "little", "5th"]
    ):
        score += 60 if (
            "第五" in zh
            or "小指" in zh
            or "小趾" in zh
            or "fifth" in all_text
            or "little" in all_text
        ) else -60

    if any(k in q for k in ["第一", "第1", "拇指", "拇趾"]) or any(
        k in q_lower for k in ["first", "thumb", "big toe", "1st"]
    ):
        score += 60 if ("第一" in zh or "拇" in zh or "first" in all_text or "thumb" in all_text) else -60

    # 節段
    if "遠節" in q or "遠端" in q or "distal" in q_lower:
        score += 40 if ("遠節" in zh or "distal" in all_text) else -40

    if "近節" in q or "近端" in q or "proximal" in q_lower:
        score += 40 if ("近節" in zh or "proximal" in all_text) else -40

    if "中節" in q or "middle" in q_lower:
        score += 40 if ("中節" in zh or "middle" in all_text) else -40

    # 指 / 趾
    if "趾" in q or "toe" in q_lower:
        score += 30 if ("趾" in zh or "toe" in all_text or "phalanges" in all_text) else -30

    if "指" in q or "finger" in q_lower:
        score += 30 if ("指" in zh or "finger" in all_text or "phalanges" in all_text) else -30

    # 左右
    if preferred_side == "Left":
        score += 20 if (place.lower() == "left" or mesh.endswith(".L")) else -20

    if preferred_side == "Right":
        score += 20 if (place.lower() == "right" or mesh.endswith(".R")) else -20

    return score


def _build_asset_search_sql(q: str) -> tuple[str, list[Any]]:
    terms = _query_terms(q)

    where_parts: list[str] = []
    params: list[Any] = []

    for term in terms:
        like_kw = f"%{term}%"
        compact_kw = f"%{_normalize_text(term)}%"

        where_parts.append(
            """
            (
                bs.small_bone_zh LIKE ?
                OR bs.small_bone_en LIKE ?
                OR m.MeshName LIKE ?
                OR REPLACE(REPLACE(REPLACE(REPLACE(m.MeshName, '_', ''), '.', ''), ' ', ''), '-', '') LIKE ?
                OR bi.bone_zh LIKE ?
                OR bi.bone_en LIKE ?
            )
            """
        )
        params.extend([like_kw, like_kw, like_kw, compact_kw, like_kw, like_kw])

    if not where_parts:
        where_parts.append("1 = 0")

    sql = f"""
    SELECT TOP 80
        bs.small_bone_id AS small_bone_id,
        bs.bone_id AS bone_id,
        bs.small_bone_zh AS bone_zh,
        bs.small_bone_en AS bone_en,
        bs.place AS place,
        m.MeshName AS mesh_name
    FROM [dbo].[bone.Bone_small] bs
    INNER JOIN [model].[BoneMeshMap] m
        ON bs.small_bone_id = m.SmallBoneId
    LEFT JOIN [dbo].[Bone_Info] bi
        ON bs.bone_id = bi.bone_id
    WHERE
        {" OR ".join(where_parts)}
    """

    return sql, params


def retrieve_3d_assets(question: str, limit: int = 6) -> list[dict]:
    q = expand_query(question).strip()
    if not q:
        return []

    preferred_side = _detect_side(q)
    sql, params = _build_asset_search_sql(q)
    print("[3D_ASSET][QUERY]", q)
    print("[3D_ASSET][PARAMS]", params)

    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(sql, *params)
            rows = cur.fetchall()
            print("[3D_ASSET][ROWS]", len(rows))

            if not rows:
                return []

            raw = [_row_to_dict(cur, r) for r in rows]

        raw.sort(
            key=lambda x: _rank_asset(x, q, preferred_side),
            reverse=True,
        )

        out = []
        seen_mesh = set()

        for c in raw:
            mesh_name = str(c.get("mesh_name") or "")
            place = str(c.get("place") or "")

            if not mesh_name:
                continue

            if preferred_side:
                if preferred_side.lower() not in place.lower():
                    if preferred_side == "Left" and not mesh_name.endswith(".L"):
                        continue
                    if preferred_side == "Right" and not mesh_name.endswith(".R"):
                        continue

            if mesh_name in seen_mesh:
                continue
            seen_mesh.add(mesh_name)

            out.append({
                "small_bone_id": c.get("small_bone_id"),
                "bone_id": c.get("bone_id"),
                "bone_zh": c.get("bone_zh"),
                "bone_en": c.get("bone_en"),
                "mesh_name": mesh_name,
                "file_path": MODEL_FILE_PATH,
                "side_zh": place or "未指定",
                "rank_score": _rank_asset(c, q, preferred_side),
            })

            if len(out) >= limit:
                break
        
        print("[3D_ASSET][OUT]", out)
        return out

    except Exception as e:
        print("[3D_ASSET] DB multi retrieve failed:", e)
        return []


def build_multi_render_plan(question: str, assets: list[dict]):
    if not assets:
        return {
            "ok": False,
            "tool": "model_render",
            "message": "目前沒有找到可用的 3D mesh 對應資料，請改用 BoneDB 206 細項骨頭正式名稱。",
            "items": [],
        }

    region, region_zh = detect_region(question)
    lesion = detect_lesion_type(question)

    items = []
    for asset in assets:
        items.append({
            "asset": asset,
            "render_plan": {
                "lesion_type": lesion["lesion_type"],
                "lesion_zh": lesion["lesion_zh"],
                "region": region,
                "region_zh": region_zh,
                "visual_marks": lesion["visual_marks"],
                "style": "educational",
                "label_mode": "leader_line",
            },
        })

    return {
        "ok": True,
        "tool": "model_render",
        "mode": "multi_asset",
        "count": len(items),
        "items": items,
    }


def detect_region(question: str) -> tuple[str, str]:
    if any(k in question for k in ["上方", "近端", "上端", "近節"]):
        return "proximal", "近端／上方"
    if any(k in question for k in ["下方", "遠端", "下端", "遠節"]):
        return "distal", "遠端／下方"
    if any(k in question for k in ["中段", "中間", "骨幹", "中節"]):
        return "shaft", "骨幹中段"
    return "general", "整體骨骼"


def retrieve_3d_asset(question: str) -> dict | None:
    q = expand_query(question).strip()
    if not q:
        return None

    preferred_side = _detect_side(q)
    sql, params = _build_asset_search_sql(q)
    print("[3D_ASSET][QUERY]", q)
    print("[3D_ASSET][PARAMS]", params)

    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(sql, *params)
            rows = cur.fetchall()
            print("[3D_ASSET][ROWS]", len(rows))

            if not rows:
                return None

            candidates = [_row_to_dict(cur, r) for r in rows]

        candidates.sort(
            key=lambda x: _rank_asset(x, q, preferred_side),
            reverse=True,
        )

        picked = candidates[0]

        # 有指定左右，優先選指定側
        if preferred_side:
            for c in candidates:
                place = str(c.get("place") or "")
                mesh_name = str(c.get("mesh_name") or "")

                if preferred_side.lower() in place.lower():
                    picked = c
                    break
                if preferred_side == "Left" and mesh_name.endswith(".L"):
                    picked = c
                    break
                if preferred_side == "Right" and mesh_name.endswith(".R"):
                    picked = c
                    break

        # 沒指定左右時，預設選右側，但前提是右側分數不能比第一名低太多
        if not preferred_side:
            top_score = _rank_asset(picked, q, preferred_side)

            for c in candidates:
                mesh_name = str(c.get("mesh_name") or "")
                place = str(c.get("place") or "")
                c_score = _rank_asset(c, q, preferred_side)

                if c_score < top_score - 20:
                    continue

                if mesh_name.endswith(".R") or place.lower() == "right":
                    picked = c
                    break

        return {
            "small_bone_id": picked.get("small_bone_id"),
            "bone_id": picked.get("bone_id"),
            "bone_zh": picked.get("bone_zh"),
            "bone_en": picked.get("bone_en"),
            "mesh_name": picked.get("mesh_name"),
            "file_path": MODEL_FILE_PATH,
            "side_zh": picked.get("place") or "未指定",
            "rank_score": _rank_asset(picked, q, preferred_side),
        }

    except Exception as e:
        print("[3D_ASSET] DB retrieve failed:", e)
        return None


def build_render_plan(question: str, asset: dict | None):
    if not asset:
        return {
            "ok": False,
            "tool": "model_render",
            "message": "目前沒有找到可用的 3D mesh 對應資料，請改用 BoneDB 206 細項骨頭正式名稱。",
        }

    region, region_zh = detect_region(question)
    lesion = detect_lesion_type(question)

    return {
        "ok": True,
        "tool": "model_render",
        "asset": asset,
        "render_plan": {
            "lesion_type": lesion["lesion_type"],
            "lesion_zh": lesion["lesion_zh"],
            "region": region,
            "region_zh": region_zh,
            "visual_marks": lesion["visual_marks"],
            "style": "educational",
            "label_mode": "leader_line",
        },
    }


def render_plan_source(render_plan: dict):
    payload = json.dumps(render_plan, ensure_ascii=False)

    return {
        "title": "3D 模型示意",
        "source_type": "3d_asset",
        "snippet": payload,
        "content": payload,
        "score": 1.0,
    }