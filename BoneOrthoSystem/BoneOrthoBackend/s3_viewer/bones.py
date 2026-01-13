# BoneOrthoBackend/s3_viewer/bones.py
from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Optional, Tuple

import pyodbc

DRIVER_NAME = os.getenv("MSSQL_DRIVER", "ODBC Driver 18 for SQL Server")
SERVER = os.getenv("MSSQL_SERVER", "localhost")
DATABASE = os.getenv("MSSQL_DATABASE", "BoneDB")
USERNAME = os.getenv("MSSQL_USERNAME", "")
PASSWORD = os.getenv("MSSQL_PASSWORD", "")


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


def _table_exists(cn: pyodbc.Connection, schema: str, table: str) -> bool:
    sql = """
    SELECT 1
    FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = ? AND t.name = ?
    """
    cur = cn.cursor()
    cur.execute(sql, schema, table)
    return cur.fetchone() is not None


def _try_select(cn: pyodbc.Connection, full_2part: str) -> bool:
    """最後保險：直接 SELECT TOP 1 1 FROM ..."""
    try:
        cn.cursor().execute(f"SELECT TOP 1 1 FROM {full_2part}")
        return True
    except Exception:
        return False


def _resolve_bone_small_table(cn: pyodbc.Connection) -> str:
    """
    你的 SSMS 顯示：dbo.bone.Bone_small
    這通常表示 schema='dbo.bone', table='Bone_small'
    所以最優先要用：[dbo.bone].[Bone_small]
    但也保留其他可能（有人用 schema=dbo, table='bone.Bone_small'）
    """
    candidates = [
        ("dbo.bone", "Bone_small", "[dbo.bone].[Bone_small]"),      # ✅ 你現在這顆（最常見）
        ("dbo", "bone.Bone_small", "[dbo].[bone.Bone_small]"),      # 另一種：table 名含點
        ("bone", "Bone_small", "[bone].[Bone_small]"),              # 傳統：schema=bone
        ("dbo", "Bone_small", "[dbo].[Bone_small]"),                # 備援
    ]

    for schema, table, two_part in candidates:
        if _table_exists(cn, schema, table):
            return two_part

    # 再保險：有時候 sys 看到、但權限/同義詞等怪事；直接試 SELECT
    for _, _, two_part in candidates:
        if _try_select(cn, two_part):
            return two_part

    # 都沒有就回第一個，讓錯誤訊息有方向
    return candidates[0][2]


def _resolve_bone_info_table(cn: pyodbc.Connection) -> str:
    candidates = [
        ("dbo", "Bone_Info", "[dbo].[Bone_Info]"),
        ("Bone_Info", None, "[Bone_Info]"),
    ]
    # 先用 sys.tables 確認 dbo.Bone_Info
    if _table_exists(cn, "dbo", "Bone_Info"):
        return "[dbo].[Bone_Info]"

    # 再試沒有 schema 的寫法（不建議，但救急）
    if _try_select(cn, "[Bone_Info]"):
        return "[Bone_Info]"

    return "[dbo].[Bone_Info]"


def _resolve_mesh_map_table(cn: pyodbc.Connection) -> str:
    if _table_exists(cn, "model", "BoneMeshMap"):
        return "[model].[BoneMeshMap]"
    if _table_exists(cn, "dbo", "BoneMeshMap"):
        return "[dbo].[BoneMeshMap]"
    if _try_select(cn, "[model].[BoneMeshMap]"):
        return "[model].[BoneMeshMap]"
    return "[model].[BoneMeshMap]"


def _side_from_place(place: Optional[str], mesh_name: Optional[str]) -> Optional[str]:
    p = (place or "").strip().lower()
    if "left" in p:
        return "L"
    if "right" in p:
        return "R"

    m = (mesh_name or "").strip()
    if re.search(r"\.(l|r)$", m, flags=re.IGNORECASE):
        return m[-1].upper()
    if re.search(r"(l|r)$", m, flags=re.IGNORECASE):
        return m[-1].upper()
    return None


def _key_base(small_bone_en: str, mesh_name: str) -> str:
    """
    合併左右成同一卡：
    - 優先用 small_bone_en（Temporal bones）
    - 去掉尾巴 L/R（含 .L / .R 或 L/R）
    """
    base = (small_bone_en or "").strip() or (mesh_name or "").strip()
    base = re.sub(r"\s+", " ", base).strip()
    base = re.sub(r"\.(L|R)$", "", base, flags=re.IGNORECASE)
    base = re.sub(r"(L|R)$", "", base, flags=re.IGNORECASE)
    return base.strip()


def get_bone_list() -> Dict[str, Any]:
    """
    回傳：
    {
      backend_server, backend_db,
      data: [
        {
          key, bone_id, bone_zh, bone_en, bone_region, bone_desc,
          count,
          left/right/center,
          items:[...]
        }
      ]
    }
    """
    with _conn() as cn:
        bone_info_table = _resolve_bone_info_table(cn)
        bone_small_table = _resolve_bone_small_table(cn)
        mesh_map_table = _resolve_mesh_map_table(cn)

        sql = f"""
        SELECT
            bi.bone_id,
            bi.bone_zh,
            bi.bone_en,
            bi.bone_region,
            bi.bone_desc,
            bs.small_bone_id,
            bs.small_bone_zh,
            bs.small_bone_en,
            bs.serial_number,
            bs.place,
            bs.note,
            mm.MeshName
        FROM {bone_info_table} bi
        JOIN {bone_small_table} bs
            ON bs.bone_id = bi.bone_id
        LEFT JOIN {mesh_map_table} mm
            ON mm.SmallBoneId = bs.small_bone_id
        ORDER BY bi.bone_region, bi.bone_id, bs.small_bone_id
        """

        cur = cn.cursor()
        try:
            cur.execute(sql)
        except Exception as e:
            return {
                "detail": {
                    "message": "Table not found or SQL error",
                    "error": str(e),
                    "bone_info_table": bone_info_table,
                    "bone_small_table": bone_small_table,
                    "mesh_map_table": mesh_map_table,
                },
                "backend_db": DATABASE,
                "backend_server": SERVER,
            }

        groups: Dict[Tuple[int, str], Dict[str, Any]] = {}

        for r in cur.fetchall():
            bone_id = int(r[0])
            bone_zh = str(r[1] or "")
            bone_en = str(r[2] or "")
            bone_region = str(r[3] or "")
            bone_desc = str(r[4] or "")

            small_bone_id = int(r[5])
            small_bone_zh = str(r[6] or "")
            small_bone_en = str(r[7] or "")
            serial_number = str(r[8] or "")
            place = str(r[9] or "")
            note = str(r[10] or "")
            mesh_name = str(r[11] or "")

            side = _side_from_place(place, mesh_name)
            key = _key_base(small_bone_en, mesh_name)

            gk = (bone_id, key)
            if gk not in groups:
                groups[gk] = {
                    "key": key,
                    "bone_id": bone_id,
                    "bone_zh": bone_zh,
                    "bone_en": bone_en,
                    "bone_region": bone_region,
                    "bone_desc": bone_desc,
                    "count": 0,
                    "left": None,
                    "right": None,
                    "center": None,
                    "items": [],
                }

            item = {
                "small_bone_id": small_bone_id,
                "small_bone_zh": small_bone_zh,
                "small_bone_en": small_bone_en,
                "serial_number": serial_number,
                "place": place,
                "note": note,
                "mesh_name": mesh_name,
                "side": side,
            }

            groups[gk]["items"].append(item)
            groups[gk]["count"] += 1

            if side == "L":
                groups[gk]["left"] = item
            elif side == "R":
                groups[gk]["right"] = item
            else:
                groups[gk]["center"] = item

        return {
            "backend_server": SERVER,
            "backend_db": DATABASE,
            "data": list(groups.values()),
        }
