# s3_viewer/body_region_api.py
from __future__ import annotations

from collections import OrderedDict
from typing import Any

from fastapi import APIRouter, HTTPException

from db import get_conn

router = APIRouter(prefix="/s3", tags=["s3-body-region"])


@router.get("/body-regions")
def get_body_regions() -> list[dict[str, Any]]:
    sql = """
    SELECT
        r.RegionKey,
        r.RegionZh,
        r.RegionEn,
        r.Side,
        r.DisplayOrder,
        COUNT(m.SmallBoneId) AS BoneCount
    FROM model.BodyRegion r
    LEFT JOIN model.BodyRegionBoneMap m
        ON r.RegionKey = m.RegionKey
    WHERE r.IsActive = 1
    GROUP BY
        r.RegionKey, r.RegionZh, r.RegionEn, r.Side, r.DisplayOrder
    ORDER BY r.DisplayOrder, r.RegionKey;
    """

    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(sql)
        rows = cur.fetchall()

    return [
        {
            "region_key": row.RegionKey,
            "region_zh": row.RegionZh,
            "region_en": row.RegionEn,
            "side": row.Side,
            "count": int(row.BoneCount or 0),
        }
        for row in rows
    ]


@router.get("/body-regions/{region_key}/bones")
def get_body_region_bones(region_key: str) -> dict[str, Any]:
    sql_region = """
    SELECT
        RegionKey,
        RegionZh,
        RegionEn,
        Side
    FROM model.BodyRegion
    WHERE RegionKey = ? AND IsActive = 1;
    """

    sql_bones = """
    SELECT
        m.GroupKey,
        m.GroupZh,
        m.GroupEn,
        m.DisplayOrder,
        bs.small_bone_id,
        bs.small_bone_zh,
        bs.small_bone_en,
        bs.place,
        bs.serial_number,
        bmm.MeshName
    FROM model.BodyRegionBoneMap m
    JOIN [dbo].[bone.Bone_small] bs
        ON m.SmallBoneId = bs.small_bone_id
    LEFT JOIN model.BoneMeshMap bmm
        ON bmm.SmallBoneId = bs.small_bone_id
    WHERE m.RegionKey = ?
    ORDER BY
        m.DisplayOrder,
        bs.small_bone_id,
        bmm.MeshName;
    """

    with get_conn() as conn:
        cur = conn.cursor()

        cur.execute(sql_region, region_key)
        region = cur.fetchone()

        if not region:
            raise HTTPException(status_code=404, detail="Body region not found")

        cur.execute(sql_bones, region_key)
        rows = cur.fetchall()

    groups_map: OrderedDict[str, dict[str, Any]] = OrderedDict()

    for row in rows:
        group_key = row.GroupKey

        if group_key not in groups_map:
            groups_map[group_key] = {
                "group_key": row.GroupKey,
                "group_zh": row.GroupZh,
                "group_en": row.GroupEn,
                "bones_map": OrderedDict(),
            }

        group = groups_map[group_key]
        bone_id = int(row.small_bone_id)

        if bone_id not in group["bones_map"]:
            group["bones_map"][bone_id] = {
                "small_bone_id": bone_id,
                "bone_zh": row.small_bone_zh,
                "bone_en": row.small_bone_en,
                "place": row.place,
                "serial_number": row.serial_number,
                "mesh_names": [],
            }

        if row.MeshName:
            group["bones_map"][bone_id]["mesh_names"].append(row.MeshName)

    groups: list[dict[str, Any]] = []

    for group in groups_map.values():
        bones = list(group["bones_map"].values())
        groups.append(
            {
                "group_key": group["group_key"],
                "group_zh": group["group_zh"],
                "group_en": group["group_en"],
                "count": len(bones),
                "bones": bones,
            }
        )

    return {
        "region_key": region.RegionKey,
        "region_zh": region.RegionZh,
        "region_en": region.RegionEn,
        "side": region.Side,
        "groups": groups,
    }