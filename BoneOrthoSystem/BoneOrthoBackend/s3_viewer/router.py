import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from db import get_connection

router = APIRouter(prefix="/s3", tags=["S3 Viewer"])


# =========================
# SQL identifiers（你的 DB 真實狀況）
# - 你的表不是 bone schema，而是 dbo schema 下「表名含點」的 bone.Bone_small
# =========================
T_BONE_INFO = "[dbo].[Bone_Info]"
T_BONE_SMALL = "[dbo].[bone.Bone_small]"
T_MESH_MAP = "[model].[BoneMeshMap]"


# =========================
# MeshName normalize / candidates
# =========================
def _normalize_mesh_name(name: str) -> str:
    s = (name or "").strip()
    s = s.replace("_", " ").strip()

    # 去掉結尾多餘的點：Temporal.L. -> Temporal.L
    while s.endswith("."):
        s = s[:-1].strip()

    # 把 .LL/.RR 收斂成 .L/.R
    s = re.sub(r"\.([LR])\1$", r".\1", s, flags=re.IGNORECASE)
    # 把 .L.L / .R.R 收斂成 .L / .R
    s = re.sub(r"\.([LR])\.\1$", r".\1", s, flags=re.IGNORECASE)

    # TemporalL -> Temporal.L（但已經是 .L/.R 就不要再補）
    if len(s) > 1 and re.search(r"[LR]$", s, flags=re.IGNORECASE) and not re.search(r"\.[LR]$", s, flags=re.IGNORECASE):
        s = s[:-1] + "." + s[-1]

    return s


def _mesh_candidates(mesh_name: str) -> List[str]:
    raw = (mesh_name or "").strip()
    n = _normalize_mesh_name(raw)

    cands = [raw, n]

    # 版本差：Temporal.L <-> TemporalL
    cands.append(n.replace(".", ""))

    # DB 如果真的存了 .LL/.RR（你目前就像）
    if re.search(r"\.L$", n, flags=re.IGNORECASE):
        cands.append(re.sub(r"\.L$", ".LL", n, flags=re.IGNORECASE))
    if re.search(r"\.R$", n, flags=re.IGNORECASE):
        cands.append(re.sub(r"\.R$", ".RR", n, flags=re.IGNORECASE))

    # 也可能存成 Temporal.L.（多一個點）
    cands.append(n + ".")

    # 去重（保序）
    out: List[str] = []
    seen = set()
    for x in cands:
        xx = (x or "").strip()
        if not xx:
            continue
        if xx in seen:
            continue
        seen.add(xx)
        out.append(xx)
    return out


# =========================
# GET /s3/bone-list
# =========================
@router.get("/bone-list")
def get_bone_list() -> List[Dict[str, Any]]:
    """
    回傳給前端左側清單用：
    mesh_name, small_bone_id, bone_id, bone_zh, bone_en, bone_region
    """
    sql = f"""
    SELECT
        m.MeshName      AS mesh_name,
        m.SmallBoneId   AS small_bone_id,
        bi.bone_id      AS bone_id,
        bi.bone_zh      AS bone_zh,
        bi.bone_en      AS bone_en,
        bi.bone_region  AS bone_region
    FROM {T_MESH_MAP} AS m
    INNER JOIN {T_BONE_SMALL} AS bs
        ON bs.small_bone_id = m.SmallBoneId
    INNER JOIN {T_BONE_INFO} AS bi
        ON bi.bone_id = bs.bone_id
    ORDER BY
        bi.bone_region,
        bi.bone_zh,
        m.MeshName;
    """

    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql)
        cols = [c[0] for c in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


# =========================
# GET /s3/bone-detail/{small_bone_id}
# =========================
@router.get("/bone-detail/{small_bone_id}")
def get_bone_detail(small_bone_id: int) -> Dict[str, Any]:
    """
    你 swagger 上就是這條路由（不是 /s3/bones/{id}）
    """
    sql = f"""
    SELECT TOP 1
        bs.small_bone_id AS small_bone_id,
        bs.bone_id       AS bone_id,
        bi.bone_zh       AS bone_zh,
        bi.bone_en       AS bone_en,
        bi.bone_region   AS bone_region,
        bi.bone_desc     AS bone_desc
    FROM {T_BONE_SMALL} AS bs
    INNER JOIN {T_BONE_INFO} AS bi
        ON bi.bone_id = bs.bone_id
    WHERE bs.small_bone_id = ?;
    """

    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, small_bone_id)
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail={"message": "SmallBoneId not found", "small_bone_id": small_bone_id})
        cols = [c[0] for c in cur.description]
        return dict(zip(cols, row))


# =========================
# GET /s3/mesh-map/{mesh_name}
# =========================
@router.get("/mesh-map/{mesh_name}")
def get_mesh_map(mesh_name: str) -> Dict[str, Any]:
    """
    MeshName -> SmallBoneId
    """
    cands = _mesh_candidates(mesh_name)
    placeholders = ",".join(["?"] * len(cands))

    sql = f"""
    SELECT TOP 1
        SmallBoneId AS small_bone_id,
        MeshName    AS mesh_name
    FROM {T_MESH_MAP}
    WHERE MeshName IN ({placeholders});
    """

    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, *cands)
        row = cur.fetchone()
        if not row:
            raise HTTPException(
                status_code=404,
                detail={
                    "message": "MeshName not found in [model].[BoneMeshMap]",
                    "input": mesh_name,
                    "normalized": _normalize_mesh_name(mesh_name),
                    "candidates": cands,
                },
            )

        cols = [c[0] for c in cur.description]
        return dict(zip(cols, row))
