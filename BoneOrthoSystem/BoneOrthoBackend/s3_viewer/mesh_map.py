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
    給人看的正規化：
    - 去頭尾空白
    - 連續空白變一格
    - 連續點變一點
    - 結尾 LL / RR 修成 L / R
    """
    s = (name or "").strip()
    if not s:
        return ""

    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"\.{2,}", ".", s)
    s = re.sub(r"([LR])\1$", r"\1", s, flags=re.IGNORECASE)

    return s


def _mesh_key(name: str) -> str:
    """
    給比對用的 key：
    fifth Distal.R / fifth_Distal.R / fifthDistalR / fifth.Distal.R
    全部壓成同一種 key：fifthdistalr
    """
    s = _normalize_mesh_name(name).lower()

    # 把常見分隔符全部拿掉
    s = re.sub(r"[\s_\-\.]+", "", s)

    # 結尾 LL / RR 再保險修一次
    s = re.sub(r"([lr])\1$", r"\1", s)

    return s


def _variants(name: str) -> List[str]:
    """
    產生候選 MeshName：
    支援：
    - fifth_Distal.R
    - fifth Distal.R
    - fifthDistal.R
    - fifth_DistalR
    - fifth DistalR
    - fifthDistalR
    """
    n = _normalize_mesh_name(name)
    if not n:
        return []

    cands: List[str] = []

    def add(x: str):
        x = (x or "").strip()
        if x and x not in cands:
            cands.append(x)

    add(n)

    # 底線 / 空格互換
    add(n.replace("_", " "))
    add(n.replace(" ", "_"))

    # 移除空格 / 底線
    add(n.replace(" ", ""))
    add(n.replace("_", ""))

    # Temporal.L -> TemporalL
    add(n.replace(".", ""))

    # fifth_Distal.R -> fifth_DistalR
    add(n.replace(".", ""))

    # fifth_Distal.R -> fifth DistalR
    add(n.replace("_", " ").replace(".", ""))

    # fifth Distal.R -> fifth_DistalR
    add(n.replace(" ", "_").replace(".", ""))

    # 如果最後是 L/R，而且沒有 .L/.R，補點
    m = re.search(r"([LR])$", n, flags=re.IGNORECASE)
    if m and not re.search(r"\.[LR]$", n, flags=re.IGNORECASE):
        add(n[:-1] + "." + n[-1])
        add(n[:-1].replace("_", " ") + "." + n[-1])
        add(n[:-1].replace(" ", "_") + "." + n[-1])

    # 如果最後是 .L/.R，也補沒有點的版本
    m2 = re.search(r"\.([LR])$", n, flags=re.IGNORECASE)
    if m2:
        add(n[:-2] + n[-1])
        add(n[:-2].replace("_", " ") + n[-1])
        add(n[:-2].replace(" ", "_") + n[-1])

    return cands


def get_mesh_map(mesh_name: str) -> Dict[str, Any]:
    raw = mesh_name
    norm = _normalize_mesh_name(raw)
    cands = _variants(raw)
    cand_keys = [_mesh_key(x) for x in cands if _mesh_key(x)]

    if not cands or not cand_keys:
        return {
            "detail": {
                "message": "Empty mesh_name",
                "input": raw,
                "normalized": norm,
                "candidates": [],
                "candidate_keys": [],
            },
            "backend_db": DATABASE,
            "backend_server": SERVER,
        }

    # 第一層：直接 IN 查詢，速度快
    placeholders = ",".join(["?"] * len(cands))
    sql_direct = f"""
    SELECT
        SmallBoneId,
        MeshName
    FROM {MESH_MAP_TABLE}
    WHERE MeshName IN ({placeholders})
    """

    matches: List[Dict[str, Any]] = []

    with _conn() as cn:
        cur = cn.cursor()

        cur.execute(sql_direct, *cands)
        for r in cur.fetchall():
            matches.append({
                "small_bone_id": int(r[0]),
                "mesh_name": str(r[1]),
                "match_type": "direct",
            })

        # 第二層：如果直接查不到，就用「壓縮 key」查
        # 這裡會讓 fifth Distal.R / fifth_Distal.R / fifthDistalR 都能互通
        if not matches:
            key_placeholders = ",".join(["?"] * len(cand_keys))

            sql_key = f"""
            SELECT
                SmallBoneId,
                MeshName
            FROM {MESH_MAP_TABLE}
            WHERE
                LOWER(
                    REPLACE(
                        REPLACE(
                            REPLACE(
                                REPLACE(MeshName, ' ', ''),
                            '_', ''),
                        '.', ''),
                    '-', '')
                ) IN ({key_placeholders})
            """

            cur.execute(sql_key, *cand_keys)
            for r in cur.fetchall():
                matches.append({
                    "small_bone_id": int(r[0]),
                    "mesh_name": str(r[1]),
                    "match_type": "normalized_key",
                })

    if not matches:
        return {
            "detail": {
                "message": f"MeshName not found in {MESH_MAP_TABLE}",
                "input": raw,
                "normalized": norm,
                "candidates": cands,
                "candidate_keys": cand_keys,
            },
            "backend_db": DATABASE,
            "backend_server": SERVER,
        }

    # 選 best match：先完全相等，再比 normalized key
    best = None

    for target in [raw, norm] + cands:
        for m in matches:
            if m["mesh_name"] == target:
                best = m
                break
        if best:
            break

    if not best:
        raw_key = _mesh_key(raw)
        for m in matches:
            if _mesh_key(m["mesh_name"]) == raw_key:
                best = m
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
        "input_key": _mesh_key(raw),
        "candidates": cands,
        "candidate_keys": cand_keys,
    }