import uuid
import pyodbc
import json

# ---------------------------------------------------------
# 連線設定
# ---------------------------------------------------------
DRIVER_NAME = "ODBC Driver 18 for SQL Server"
CONN_STR = (
    f"DRIVER={{{DRIVER_NAME}}};"
    "SERVER=localhost\\SQLEXPRESS;"
    "DATABASE=BoneDB;"
    "Trusted_Connection=yes;"
    "Encrypt=yes;"
    "TrustServerCertificate=yes;"
)

def get_connection():
    """回傳一個 pyodbc connection。建議用 with 管理。"""
    return pyodbc.connect(CONN_STR)

# ---------------------------------------------------------
# YOLO → 大表 Bone_Info 映射
# ---------------------------------------------------------

# YOLO 類別名稱有些是單數，資料庫是複數，先做對應
_CLASS_ALIASES = {
    "Tibia": "Tibiae",
    "Femur": "Femora",
    "Radius": "Radii",
    "Ulna": "Ulnae",
    # 之後如果還有不對的，就在這裡多補幾個
}

def _normalize_en(name: str) -> str:
    """把 YOLO 的英文類別，轉成跟 Bone_Info.bone_en 一樣的字串。"""
    return _CLASS_ALIASES.get(name, name)

def get_bone_zh_en_by_en(bone_en: str):
    """
    用 YOLO 的英文類別名稱（bone_en）去查「大表」 BoneDB.dbo.Bone_Info
    回傳 (bone_zh, bone_en)

    查不到就回傳 (None, None)
    """
    bone_en_for_db = _normalize_en(bone_en)

    sql = """
        SELECT bone_zh, bone_en
        FROM dbo.Bone_Info
        WHERE LOWER(bone_en) = LOWER(?)
    """

    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, bone_en_for_db)
        row = cur.fetchone()

    if row:
        return row[0], row[1]

    return None, None

# ---------------------------------------------------------
# 聊天室／訊息 相關 (agent schema)
# ---------------------------------------------------------

def create_conversation(user_id: str, title: str | None = None, source: str = "S2") -> str:
    """
    建立一個新的聊天室，回傳 ConversationId
    """
    conv_id = str(uuid.uuid4())
    sql = """
        INSERT INTO agent.Conversation
            (ConversationId, UserId, Title, Source, CreatedAt, UpdatedAt)
        VALUES (?, ?, ?, ?, SYSUTCDATETIME(), SYSUTCDATETIME())
    """
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, conv_id, user_id, title, source)
        conn.commit()
    return conv_id

def touch_conversation(conv_id: str):
    """
    有新訊息時更新 UpdatedAt
    """
    sql = """
        UPDATE agent.Conversation
        SET UpdatedAt = SYSUTCDATETIME()
        WHERE ConversationId = ?
    """
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, conv_id)
        conn.commit()

def add_message(
    conversation_id: str,
    role: str,
    content: str,
    attachments_json: str | None = None,
    meta_json: str | None = None,
) -> str:
    """
    新增一則訊息到 agent.ConversationMessage

    attachments_json:
        - 文字訊息：通常是 None
        - 圖片訊息：存 {"url": "...", "filetype": "..."} 的 JSON 字串
    meta_json:
        - 目前先預留欄位，用不到可以都放 None
    """
    msg_id = str(uuid.uuid4())

    sql = """
        INSERT INTO agent.ConversationMessage
            (MessageId, ConversationId, Role, Content, AttachmentsJson, MetaJson, CreatedAt)
        VALUES (?, ?, ?, ?, ?, ?, SYSUTCDATETIME())
    """

    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            sql,
            msg_id,
            conversation_id,
            role,
            content,
            attachments_json,
            meta_json,
        )
        conn.commit()

    # 有新訊息，順便更新對話時間
    touch_conversation(conversation_id)
    return msg_id

def list_conversations(user_id: str):
    """
    依 user 抓聊天室清單（左邊 sidebar 用）
    """
    sql = """
        SELECT ConversationId, UserId, Title, Source, CreatedAt, UpdatedAt
        FROM agent.Conversation
        WHERE UserId = ?
        ORDER BY UpdatedAt DESC
    """
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, user_id)
        rows = cur.fetchall()

    result = []
    for r in rows:
        result.append(
            {
                "conversation_id": str(r[0]),
                "user_id": r[1],
                "title": r[2],
                "source": r[3],
                "created_at": r[4],
                "updated_at": r[5],
            }
        )
    return result

def get_messages(conversation_id: str):
    """
    抓某個聊天室的所有訊息（進聊天室後載入歷史）
    """
    sql = """
        SELECT MessageId, Role, Content, AttachmentsJson, MetaJson, CreatedAt
        FROM agent.ConversationMessage
        WHERE ConversationId = ?
        ORDER BY CreatedAt ASC
    """
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, conversation_id)
        rows = cur.fetchall()

    result = []
    for r in rows:
        result.append(
            {
                "message_id": str(r[0]),
                "role": r[1],
                "content": r[2],
                "attachments_json": r[3],
                "meta_json": r[4],
                "created_at": r[5],
            }
        )
    return result

def update_conversation_title(conversation_id: str, title: str):
    sql = """
        UPDATE agent.Conversation
        SET Title = ?, UpdatedAt = SYSUTCDATETIME()
        WHERE ConversationId = ?
    """
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, title, conversation_id)
        conn.commit()

def set_conversation_title_if_empty(conversation_id: str, first_text: str):
    """
    如果聊天室還沒有 Title，就用第一句文字當標題（最多 30 字）。
    給 main.py 在第一句 user 訊息時呼叫用。
    """
    if not first_text:
        return

    short_title = first_text.strip()
    if not short_title:
        return

    if len(short_title) > 30:
        short_title = short_title[:30]

    with get_connection() as conn:
        cur = conn.cursor()
        # 先看現在有沒有 title
        cur.execute(
            "SELECT Title FROM agent.Conversation WHERE ConversationId = ?",
            conversation_id,
        )
        row = cur.fetchone()
        if not row:
            return

        current_title = row[0]
        if current_title:  # 已經有標題就不改
            return

        # 更新 Title
        cur.execute(
            """
            UPDATE agent.Conversation
            SET Title = ?, UpdatedAt = SYSUTCDATETIME()
            WHERE ConversationId = ?
            """,
            short_title,
            conversation_id,
        )
        conn.commit()

# ---------------------------------------------------------
# 刪除聊天室（新增的，不會動到原本功能）
# ---------------------------------------------------------

def delete_conversation(conversation_id: str):
    """
    刪除一個聊天室以及底下的所有訊息。
    先刪 agent.ConversationMessage，再刪 agent.Conversation。
    """
    with get_connection() as conn:
        cur = conn.cursor()
        # 先刪訊息
        cur.execute(
            "DELETE FROM agent.ConversationMessage WHERE ConversationId = ?",
            conversation_id,
        )
        # 再刪聊天室
        cur.execute(
            "DELETE FROM agent.Conversation WHERE ConversationId = ?",
            conversation_id,
        )
        conn.commit()

# ---------------------------------------------------------
# Bone_Images：依 bone_id 取出圖片（二進位）給 FastAPI 回傳
# ---------------------------------------------------------

def get_bone_image_binary(bone_id: int):
    """
    依 bone_id 從 dbo.Bone_Images 抓一張圖的 bytes + content_type。
    找不到就回傳 None。
    """
    sql = """
        SELECT TOP 1 image_data, content_type
        FROM dbo.Bone_Images
        WHERE bone_id = ?
        ORDER BY image_id
    """
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, bone_id)
        row = cur.fetchone()

    if not row:
        return None

    image_data = row[0]
    content_type = row[1] or "image/png"
    return image_data, content_type
