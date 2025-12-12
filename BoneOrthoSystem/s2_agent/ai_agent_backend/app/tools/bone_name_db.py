# app/tools/bone_name_db.py
from typing import Dict, Iterable
from db import get_connection


def _fetch_name_for_label(label: str) -> str | None:
    """
    給一個 YOLO label（例如 'Carpals'），
    盡量從 BoneDB 撈出「中文 + 英文」的正式名稱。

    這裡假設：
      - dbo.Bone_Info 有欄位 bone_en, bone_zh
      - dbo.bone.Bone_small 有欄位 small_bone_en, small_bone_zh

    如果實際欄位不同，就把 SQL 的欄位名稱改掉即可。
    """
    if not label:
        return None

    with get_connection() as conn:
        cursor = conn.cursor()

        # 先從細項表找（bone.Bone_small）
        cursor.execute(
            """
            SELECT TOP 1 small_bone_zh, small_bone_en
            FROM dbo.bone.Bone_small
            WHERE small_bone_en = ?
            """,
            label,
        )
        row = cursor.fetchone()
        if row:
            zh, en = row
            zh = zh or ""
            en = en or ""
            if zh and en:
                return f"{zh} ({en})"
            if zh:
                return zh
            if en:
                return en

        # 再從大類表找（dbo.Bone_Info）
        cursor.execute(
            """
            SELECT TOP 1 bone_zh, bone_en
            FROM dbo.Bone_Info
            WHERE bone_en = ?
            """,
            label,
        )
        row = cursor.fetchone()
        if row:
            zh, en = row
            zh = zh or ""
            en = en or ""
            if zh and en:
                return f"{zh} ({en})"
            if zh:
                return zh
            if en:
                return en

    return None


def build_label_display_map(labels: Iterable[str]) -> Dict[str, str]:
    """
    給一串 YOLO label，批次從 DB 撈「中 + 英」名稱。
    撈不到就用原本的 label 當預設值。
    """
    mapping: Dict[str, str] = {}
    unique_labels = {str(l) for l in labels if l}

    for label in unique_labels:
        display = _fetch_name_for_label(label)

    return mapping
