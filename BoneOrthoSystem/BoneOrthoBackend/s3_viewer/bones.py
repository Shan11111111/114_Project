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


def attach_bone_routes(router: APIRouter) -> None:
    @router.get("/bone-list")
    def get_bone_list():
        """
        給前端清單用：
        - mesh_name, small_bone_id, bone_id, bone_zh, bone_en, bone_region
        """
        sql = """
        SELECT
            m.MeshName        AS mesh_name,
            m.SmallBoneId     AS small_bone_id,
            s.bone_id         AS bone_id,
            bi.bone_zh        AS bone_zh,
            bi.bone_en        AS bone_en,
            bi.bone_region    AS bone_region
        FROM model.BoneMeshMap m
        JOIN bone.Bone_small s
            ON s.small_bone_id = m.SmallBoneId
        JOIN dbo.Bone_Info bi
            ON bi.bone_id = s.bone_id
        ORDER BY bi.bone_region, bi.bone_zh, m.MeshName
        """
        return _query_all(sql)

    @router.get("/bone-detail/{small_bone_id}")
    def get_bone_detail(small_bone_id: int):
        """
        給前端點選後顯示資訊用
        """
        sql = """
        SELECT
            s.small_bone_id   AS small_bone_id,
            s.bone_id         AS bone_id,
            bi.bone_zh        AS bone_zh,
            bi.bone_en        AS bone_en,
            bi.bone_region    AS bone_region,
            bi.bone_desc      AS bone_desc
        FROM bone.Bone_small s
        JOIN dbo.Bone_Info bi
            ON bi.bone_id = s.bone_id
        WHERE s.small_bone_id = ?
        """
        row = _query_one(sql, [small_bone_id])
        if not row:
            raise HTTPException(status_code=404, detail={"message": "small_bone_id not found", "small_bone_id": small_bone_id})
        return row
