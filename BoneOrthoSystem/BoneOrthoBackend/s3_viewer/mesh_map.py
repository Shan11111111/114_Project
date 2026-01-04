import os
import re
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException

from db import get_connection


def _query_all(sql: str, params=None) -> List[Dict[str, Any]]:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, params or [])
        cols = [c[0] for c in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def _query_one(sql: str, params=None) -> Optional[Dict[str, Any]]:
    rows = _query_all(sql, params)
    return rows[0] if rows else None


def _normalize_mesh_name(name: str) -> str:
    s = (name or "").strip()

    # 去掉尾巴多餘點：Temporal.L. -> Temporal.L
    while s.endswith("."):
        s = s[:-1].strip()

    # 常見錯字修正：Temporal.LL / Temporal.RR -> Temporal.L / Temporal.R
    s = re.sub(r"\.([LR])\1$", r".\1", s)

    # TemporalL -> Temporal.L（但已經有 .L/.R 就不要亂補）
    if len(s) > 1 and (s.endswith("L") or s.endswith("R")) and (not s.endswith(".L")) and (not s.endswith(".R")):
        s = s[:-1] + "." + s[-1]

    return s


def attach_mesh_map_routes(router: APIRouter) -> None:
    @router.get("/mesh-map/{mesh_name}")
    def get_mesh_map(mesh_name: str):
        """
        MeshName -> SmallBoneId
        - 支援常見命名差異：TemporalL / Temporal.L / Temporal.L.
        """
        raw = mesh_name
        norm = _normalize_mesh_name(raw)

        # 先 exact（大小寫不敏感）
        sql_exact = """
        SELECT TOP 1
            SmallBoneId AS small_bone_id,
            MeshName    AS mesh_name
        FROM model.BoneMeshMap
        WHERE LOWER(MeshName) = LOWER(?)
        """
        hit = _query_one(sql_exact, [norm])
        if hit:
            return hit

        # 再做候選：把 .L/.R 拿掉去找 base，再回推最像的
        base = re.sub(r"\.([LR])$", "", norm)

        sql_like = """
        SELECT TOP 50
            SmallBoneId AS small_bone_id,
            MeshName    AS mesh_name
        FROM model.BoneMeshMap
        WHERE LOWER(MeshName) LIKE LOWER(?)
        ORDER BY MeshName
        """
        cands = _query_all(sql_like, [base + "%"])

        # 如果候選裡有 exact norm（再比一次）
        for c in cands:
            if _normalize_mesh_name(c["mesh_name"]).lower() == norm.lower():
                return {"small_bone_id": c["small_bone_id"], "mesh_name": c["mesh_name"]}

        raise HTTPException(
            status_code=404,
            detail={
                "message": "MeshName not found in [model].[BoneMeshMap]",
                "input": raw,
                "normalized": norm,
                "candidates": [c["mesh_name"] for c in cands[:10]],
                "backend_db": os.getenv("MSSQL_DATABASE", "BoneDB"),
                "backend_server": os.getenv("MSSQL_SERVER", "localhost"),
            },
        )
