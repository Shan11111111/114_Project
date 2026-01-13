# BoneOrthoBackend/s3_viewer/mesh_map.py
from __future__ import annotations

import os
import re
from typing import Any, Dict, List

import pyodbc

DRIVER_NAME = os.getenv("MSSQL_DRIVER", "ODBC Driver 18 for SQL Server")
SERVER = os.getenv("MSSQL_SERVER", "localhost")
DATABASE = os.getenv("MSSQL_DATABASE", "BoneDB")
USERNAME = os.getenv("MSSQL_USERNAME", "")
PASSWORD = os.getenv("MSSQL_PASSWORD", "")

MESH_MAP_TABLE = os.getenv("MESH_MAP_TABLE", "[model].[BoneMeshMap]")


def _conn() -> pyodbc.Connection:
    if USERNAME and PASSWORD:
        cs = (
            f"DRIVER={{{DRIVER_NAME}}};"
            f"SERVER={SERVER};DATABASE={DATABASE};"
            f"UID={USERNAME};PWD={PASSWORD};"
            "TrustServerCertificate=yes;"
        )
    else:
        cs = (
            f"DRIVER={{{DRIVER_NAME}}};"
            f"SERVER={SERVER};DATABASE={DATABASE};"
            "Trusted_Connection=yes;"
            "TrustServerCertificate=yes;"
        )
    return pyodbc.connect(cs)


def _normalize_mesh_name(name: str) -> str:
    """
    讓前端丟 TemporalL / Temporal.L / TemporalLL / Temporal..L 都能對到
    """
    s = (name or "").strip()
    if not s:
        return ""

    # 連續點縮成一個點：Temporal..L -> Temporal.L
    s = re.sub(r"\.{2,}", ".", s)

    # TemporalLL / TemporalRR -> TemporalL / TemporalR（只修最後一段）
    s = re.sub(r"([LR])\1$", r"\1", s, flags=re.IGNORECASE)

    return s


def _variants(name: str) -> List[str]:
    """
    產生候選名稱，涵蓋 GLB 匯出會把 Temporal.L 變 TemporalL 的狀況
    """
    n = _normalize_mesh_name(name)
    if not n:
        return []

    cands: List[str] = []
    cands.append(n)

    # Temporal.L -> TemporalL
    cands.append(n.replace(".", ""))

    # TemporalL -> Temporal.L（把最後 L/R 補回點）
    m = re.search(r"([LR])$", n, flags=re.IGNORECASE)
    if m and not re.search(r"\.[LR]$", n, flags=re.IGNORECASE):
        cands.append(n[:-1] + "." + n[-1])

    # 再補：把點移除（避免 weird case）
    cands.append(cands[-1].replace(".", ""))

    # 去重保序
    seen = set()
    out: List[str] = []
    for x in cands:
        if x and x not in seen:
            seen.add(x)
            out.append(x)
    return out


def get_mesh_map(mesh_name: str) -> Dict[str, Any]:
    raw = mesh_name
    norm = _normalize_mesh_name(raw)
    cands = _variants(raw)

    if not cands:
        return {
            "detail": {
                "message": "Empty mesh_name",
                "input": raw,
                "normalized": norm,
                "candidates": [],
            },
            "backend_db": DATABASE,
            "backend_server": SERVER,
        }

    placeholders = ",".join(["?"] * len(cands))
    sql = f"""
    SELECT
        SmallBoneId,
        MeshName
    FROM {MESH_MAP_TABLE}
    WHERE MeshName IN ({placeholders})
    """

    matches: List[Dict[str, Any]] = []
    with _conn() as cn:
        cur = cn.cursor()
        cur.execute(sql, *cands)
        for r in cur.fetchall():
            matches.append({"small_bone_id": int(r[0]), "mesh_name": str(r[1])})

    if not matches:
        return {
            "detail": {
                "message": f"MeshName not found in {MESH_MAP_TABLE}",
                "input": raw,
                "normalized": norm,
                "candidates": cands,
            },
            "backend_db": DATABASE,
            "backend_server": SERVER,
        }

    best = None
    for target in [raw, norm] + cands:
        for m in matches:
            if m["mesh_name"] == target:
                best = m
                break
        if best:
            break
    if not best:
        best = matches[0]

    return {
        "backend_db": DATABASE,
        "backend_server": SERVER,
        "best_match": best,
        "matches": matches,
        "input": raw,
        "normalized": norm,
        "candidates": cands,
    }
