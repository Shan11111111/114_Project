import pyodbc

CONN_STR = (
    "DRIVER={ODBC Driver 17 for SQL Server};"
    "SERVER=localhost;"          # 如果你是 SQLEXPRESS → SERVER=localhost\\SQLEXPRESS
    "DATABASE=BoneDB;"
    "Trusted_Connection=yes;"
)

def get_connection():
    return pyodbc.connect(CONN_STR)


def get_bone_info_by_english_name(bone_en: str):
    """
    依照 BoneDB.dbo.Bone_Info 的欄位名稱查詢
    bone_en = YOLO 返回的 cls_name，例如：'Clavicle'
    """

    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT TOP 1
                bone_id,
                bone_en,
                bone_zh,
                bone_region,
                bone_desc
            FROM dbo.Bone_Info
            WHERE bone_en = ?
        """, bone_en)

        row = cur.fetchone()
        if not row:
            return None

        return {
            "bone_id": row.bone_id,
            "bone_en": row.bone_en,
            "bone_zh": row.bone_zh,
            "bone_region": row.bone_region,
            "bone_desc": row.bone_desc,
        }

    finally:
        conn.close()
