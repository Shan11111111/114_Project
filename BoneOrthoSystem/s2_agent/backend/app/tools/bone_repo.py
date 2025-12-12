from db import get_connection

def get_bone_zh_en_by_en(bone_en: str):
    """
    用 YOLO 的英文類別名稱（bone_en）去查 BoneDB
    回傳 (bone_zh, bone_en)
    """

    sql = """
        SELECT bone_zh, bone_en
        FROM dbo.Bone_Info
        WHERE LOWER(bone_en) = ?
    """

    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, bone_en.lower())
        row = cur.fetchone()

        if row:
            return row[0], row[1]
        else:
            return bone_en, bone_en
