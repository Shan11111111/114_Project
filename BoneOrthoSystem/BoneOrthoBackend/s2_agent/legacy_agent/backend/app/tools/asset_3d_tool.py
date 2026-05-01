# s2_agent/legacy_agent/backend/app/tools/asset_3d_tool.py

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

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

    if any(k in q for k in ["左", "左側", "left", "Left", ".L"]):
        return "Left"

    if any(k in q for k in ["右", "右側", "right", "Right", ".R"]):
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

def retrieve_3d_assets(question: str, limit: int = 6) -> list[dict]:
    q = (question or "").strip()
    if not q:
        return []

    preferred_side = _detect_side(q)

    sql = """
    SELECT TOP 50
        bs.small_bone_id AS small_bone_id,
        bs.bone_id AS bone_id,
        bs.small_bone_zh AS bone_zh,
        bs.small_bone_en AS bone_en,
        bs.place AS place,
        m.MeshName AS mesh_name
    FROM [dbo].[bone.Bone_small] bs
    INNER JOIN [model].[BoneMeshMap] m
        ON bs.small_bone_id = m.SmallBoneId
    WHERE
        ? LIKE N'%' + bs.small_bone_zh + N'%'
        OR LOWER(?) LIKE N'%' + LOWER(bs.small_bone_en) + N'%'
        OR LOWER(?) LIKE N'%' + LOWER(m.MeshName) + N'%'
        OR LOWER(?) LIKE N'%' + LOWER(REPLACE(m.MeshName, '.', '')) + N'%'
    ORDER BY
        LEN(bs.small_bone_zh) DESC,
        bs.small_bone_id ASC
    """

    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(sql, q, q, q, q)
            rows = cur.fetchall()

        if not rows:
            return []

        raw = [_row_to_dict(cur, r) for r in rows]

        # 去重：同一個 small_bone_id 如果有左右，依使用者指定；沒指定就保留全部，但最多 limit
        out = []
        seen_mesh = set()

        for c in raw:
            mesh_name = str(c.get("mesh_name") or "")
            place = str(c.get("place") or "")

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
            })

            if len(out) >= limit:
                break

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
    if any(k in question for k in ["上方", "近端", "上端"]):
        return "proximal", "近端／上方"
    if any(k in question for k in ["下方", "遠端", "下端"]):
        return "distal", "遠端／下方"
    if any(k in question for k in ["中段", "中間", "骨幹"]):
        return "shaft", "骨幹中段"
    return "general", "整體骨骼"

def retrieve_3d_asset(question: str) -> dict | None:
    q = (question or "").strip()
    if not q:
        return None

    preferred_side = _detect_side(q)

    sql = """
    SELECT TOP 20
        bs.small_bone_id AS small_bone_id,
        bs.bone_id AS bone_id,
        bs.small_bone_zh AS bone_zh,
        bs.small_bone_en AS bone_en,
        bs.place AS place,
        m.MeshName AS mesh_name
    FROM [dbo].[bone.Bone_small] bs
    INNER JOIN [model].[BoneMeshMap] m
        ON bs.small_bone_id = m.SmallBoneId
    WHERE
        ? LIKE N'%' + bs.small_bone_zh + N'%'
        OR LOWER(?) LIKE N'%' + LOWER(bs.small_bone_en) + N'%'
        OR LOWER(?) LIKE N'%' + LOWER(m.MeshName) + N'%'
        OR LOWER(?) LIKE N'%' + LOWER(REPLACE(m.MeshName, '.', '')) + N'%'
    ORDER BY
        LEN(bs.small_bone_zh) DESC,
        bs.small_bone_id ASC
    """

    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(sql, q, q, q, q)
            rows = cur.fetchall()

        if not rows:
            return None

        candidates = [_row_to_dict(cur, r) for r in rows]

        picked = candidates[0]

        # 沒指定左右時，預設選右側
        if not preferred_side:
            for c in candidates:
                mesh_name = str(c.get("mesh_name") or "")
                place = str(c.get("place") or "")
                if mesh_name.endswith(".R") or place.lower() == "right":
                    picked = c
                    break

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

        return {
            "small_bone_id": picked.get("small_bone_id"),
            "bone_id": picked.get("bone_id"),
            "bone_zh": picked.get("bone_zh"),
            "bone_en": picked.get("bone_en"),
            "mesh_name": picked.get("mesh_name"),
            "file_path": MODEL_FILE_PATH,
            "side_zh": picked.get("place") or "未指定",
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