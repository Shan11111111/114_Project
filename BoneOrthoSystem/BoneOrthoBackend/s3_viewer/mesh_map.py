# BoneOrthoBackend/s3_viewer/mesh_map.py
from __future__ import annotations

import os
import re
from typing import Any, Dict, List

import pyodbc

from .bones import (
    _resolve_bone_small_table,
    _resolve_bone_info_table,
    _resolve_mesh_map_table,
)



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
    s = (name or "").strip()
    if not s:
        return ""

    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"\.{2,}", ".", s)
    s = re.sub(r"([LR])\1$", r"\1", s, flags=re.IGNORECASE)
    return s


def _mesh_key(name: str) -> str:
    """
    fifth Distal.R / fifth_Distal.R / fifthDistalR / fifth.Distal.R
    全部壓成 fifthdistalr
    """
    s = _normalize_mesh_name(name).lower()
    s = re.sub(r"[\s_\-\.]+", "", s)
    s = re.sub(r"([lr])\1$", r"\1", s)
    return s


def _variants(name: str) -> List[str]:
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

    # 移除點
    add(n.replace(".", ""))

    # 混合處理
    add(n.replace("_", " ").replace(".", ""))
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

def _bone_like_terms(bone_name: str, mesh_name: str = "") -> List[str]:
    """
    bone=遠節指骨 / 遠節趾骨 這種不完整名稱，
    要展開成多個 LIKE 關鍵字。
    """
    raw = str(bone_name or "").strip()
    mesh = str(mesh_name or "").lower()

    terms: List[str] = []

    def add(x: str):
        x = str(x or "").strip()
        if x and x not in terms:
            terms.append(x)

    add(raw)

    # 指 / 趾 互換
    if "指" in raw:
        add(raw.replace("指", "趾"))
    if "趾" in raw:
        add(raw.replace("趾", "指"))
        
    if "第三" in raw or "第3" in raw:
        add("第三")
        add("第三趾")
        add("第三指")
        add("Third")
        add("third")

    if "第二" in raw or "第2" in raw:
        add("第二")
        add("第二趾")
        add("第二指")
        add("Second")
        add("second")

    if "第四" in raw or "第4" in raw:
        add("第四")
        add("第四趾")
        add("第四指")
        add("Fourth")
        add("fourth")

    if "第五" in raw or "第5" in raw:
        add("第五")
        add("第五趾")
        add("第五指")
        add("Fifth")
        add("fifth")
        add("Little")
        add("little")

    # 遠節指骨 / 遠節趾骨常見關鍵字
    if "遠節" in raw:
        add("遠節指骨")
        add("遠節趾骨")
        add("遠節")
        add("Distal")

    if "近節" in raw:
        add("近節指骨")
        add("近節趾骨")
        add("近節")
        add("Proximal")

    if "中節" in raw:
        add("中節指骨")
        add("中節趾骨")
        add("中節")
        add("Middle")

    # Little 通常代表小指 / 小趾 / 第五
    if "little" in mesh or "fifth" in mesh or "5" in mesh:
        add("第五")
        add("小指")
        add("小趾")
        add("fifth")
        add("little")

    if "thumb" in mesh or "big" in mesh or "first" in mesh or "1" in mesh:
        add("拇")
        add("第一")
        add("first")
        add("thumb")

    return terms

def _mesh_rank_score(row: Dict[str, Any], raw_mesh: str, bone_name: str) -> int:
    """
    bone LIKE 查到多筆時，用 mesh 裡的 first/second/fifth + L/R 幫忙排序。
    例如：bone=遠節趾骨 + mesh=fifth_Distal.R
    應該優先第五趾遠節趾骨 R。
    """
    score = 0

    mesh = str(row.get("mesh_name") or "")
    mesh_lower = mesh.lower()
    zh = str(row.get("small_bone_zh") or "")
    raw = str(raw_mesh or "").lower()
    bone_kw = str(bone_name or "").strip()

    if _mesh_key(mesh) == _mesh_key(raw_mesh):
        score += 100

    if bone_kw and bone_kw in zh:
        score += 20

    # 趾 / 指序號判斷
    if "fifth" in raw or "little" in raw or "5" in raw:
        if (
            "第五" in zh
            or "小指" in zh
            or "小趾" in zh
            or "5" in mesh_lower
            or "fifth" in mesh_lower
            or "little" in mesh_lower
        ):
            score += 30

    if "fourth" in raw or "4" in raw:
        if "第四" in zh or "4" in mesh_lower or "fourth" in mesh_lower:
            score += 30

    if "third" in raw or "3" in raw:
        if "第三" in zh or "3" in mesh_lower or "third" in mesh_lower:
            score += 30

    if "second" in raw or "2" in raw:
        if "第二" in zh or "2" in mesh_lower or "second" in mesh_lower:
            score += 30

    if "first" in raw or "1" in raw:
        if "第一" in zh or "拇" in zh or "1" in mesh_lower or "first" in mesh_lower:
            score += 30

    # 左右側判斷
    if re.search(r"(\.r|_r|r)$", raw):
        if re.search(r"(\.r|_r|r)$", mesh_lower):
            score += 10

    if re.search(r"(\.l|_l|l)$", raw):
        if re.search(r"(\.l|_l|l)$", mesh_lower):
            score += 10

    return score


def get_mesh_map(mesh_name: str, bone_name: str = "") -> Dict[str, Any]:
    raw = mesh_name
    norm = _normalize_mesh_name(raw)
    cands = _variants(raw)
    cand_keys = [_mesh_key(x) for x in cands if _mesh_key(x)]

    matches: List[Dict[str, Any]] = []

    if not cands or not cand_keys:
        # mesh 空的時候，仍然允許 bone 模糊查
        if not bone_name:
            return {
                "detail": {
                    "message": "Empty mesh_name and bone_name",
                    "input": raw,
                    "bone_name": bone_name,
                    "normalized": norm,
                    "candidates": [],
                    "candidate_keys": [],
                },
                "backend_db": DATABASE,
                "backend_server": SERVER,
            }

    with _conn() as cn:
        cur = cn.cursor()

        mesh_map_table = _resolve_mesh_map_table(cn)
        bone_small_table = _resolve_bone_small_table(cn)
        bone_info_table = _resolve_bone_info_table(cn)

        # 第一層：MeshName 直接 IN 查詢
        if cands:
            placeholders = ",".join(["?"] * len(cands))
            sql_direct = f"""
            SELECT
                SmallBoneId,
                MeshName
            FROM {mesh_map_table}
            WHERE MeshName IN ({placeholders})
            """

            cur.execute(sql_direct, *cands)
            for r in cur.fetchall():
                matches.append({
                    "small_bone_id": int(r[0]),
                    "mesh_name": str(r[1]),
                    "match_type": "direct",
                })

        # 第二層：壓縮 key 查詢
        if not matches and cand_keys:
            key_placeholders = ",".join(["?"] * len(cand_keys))

            sql_key = f"""
            SELECT
                SmallBoneId,
                MeshName
            FROM {mesh_map_table}
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

        # 第三層：mesh 查不到時，用中文 / 英文骨名 LIKE 模糊查
                # 第三層：mesh 查不到時，用三表 join 做中文 / 英文 / MeshName 模糊查
        if not matches and bone_name:
            bone_kw = str(bone_name).strip()

            if bone_kw:
                like_terms = _bone_like_terms(bone_kw, raw)

                where_parts = []
                params = []

                for term in like_terms:
                    like_kw = f"%{term}%"
                    where_parts.append(
                        """
                        (
                            m.MeshName LIKE ?
                            OR s.small_bone_zh LIKE ?
                            OR s.small_bone_en LIKE ?
                            OR b.bone_zh LIKE ?
                            OR b.bone_en LIKE ?
                        )
                        """
                    )
                    params.extend([like_kw, like_kw, like_kw, like_kw, like_kw])

                sql_bone_like = f"""
                SELECT
                    m.SmallBoneId,
                    m.MeshName,
                    s.small_bone_zh,
                    s.small_bone_en,
                    s.serial_number,
                    s.place,
                    b.bone_zh,
                    b.bone_en,
                    b.bone_region
                FROM {mesh_map_table} m
                LEFT JOIN {bone_small_table} s
                    ON m.SmallBoneId = s.small_bone_id
                LEFT JOIN {bone_info_table} b
                    ON s.bone_id = b.bone_id
                WHERE
                    {" OR ".join(where_parts)}
                """

                cur.execute(sql_bone_like, *params)

                for r in cur.fetchall():
                    matches.append({
                        "small_bone_id": int(r[0]),
                        "mesh_name": str(r[1]),
                        "small_bone_zh": str(r[2] or ""),
                        "small_bone_en": str(r[3] or ""),
                        "serial_number": str(r[4] or ""),
                        "place": str(r[5] or ""),
                        "bone_zh": str(r[6] or ""),
                        "bone_en": str(r[7] or ""),
                        "bone_region": str(r[8] or ""),
                        "match_type": "bone_keyword_like",
                    })

    if not matches:
        return {
            "detail": {
                "message": f"MeshName not found in {MESH_MAP_TABLE}",
                "input": raw,
                "bone_name": bone_name,
                "normalized": norm,
                "candidates": cands,
                "candidate_keys": cand_keys,
            },
            "backend_db": DATABASE,
            "backend_server": SERVER,
        }

    # 排序：讓最像 URL mesh + bone 的結果排前面
    matches.sort(
        key=lambda x: _mesh_rank_score(x, raw, bone_name),
        reverse=True,
    )

    best = None

    # 先找完全相等
    for target in [raw, norm] + cands:
        for m in matches:
            if m["mesh_name"] == target:
                best = m
                break
        if best:
            break

    # 再找壓縮 key 相等
    if not best:
        raw_key = _mesh_key(raw)
        for m in matches:
            if _mesh_key(m["mesh_name"]) == raw_key:
                best = m
                break

    # 最後用排序第一名
    if not best:
        best = matches[0]

    return {
        "backend_db": DATABASE,
        "backend_server": SERVER,
        "best_match": best,
        "matches": matches,
        "input": raw,
        "bone_name": bone_name,
        "normalized": norm,
        "input_key": _mesh_key(raw),
        "candidates": cands,
        "candidate_keys": cand_keys,
    }