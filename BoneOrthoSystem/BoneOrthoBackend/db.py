# BoneOrthoBackend/db.py
import os
import json
import re
import uuid
from typing import Optional, List, Dict, Any

import pyodbc

# =========================
# SQL Server Connection
# =========================

DRIVER_NAME = os.getenv("MSSQL_DRIVER", "ODBC Driver 18 for SQL Server")
SERVER = os.getenv("MSSQL_SERVER", "localhost")
DATABASE = os.getenv("MSSQL_DATABASE", "BoneDB")
TRUSTED = os.getenv("MSSQL_TRUSTED", "yes")  # Windows 驗證

CONN_STR = (
    f"DRIVER={{{DRIVER_NAME}}};"
    f"SERVER={SERVER};"
    f"DATABASE={DATABASE};"
    f"Trusted_Connection={TRUSTED};"
    "Encrypt=yes;"
    "TrustServerCertificate=yes;"
)

def get_connection():
    return pyodbc.connect(CONN_STR)

def query_all(sql: str, params=None):
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, params or [])
        cols = [c[0] for c in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]

def execute(sql: str, params=None):
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, params or [])
        conn.commit()
        return cur.rowcount


# =========================
# S2 needs (YOLO label -> DB name)
# =========================

def get_bone_zh_en_by_en(bone_en: str):
    """
    legacy_agent/tools/yolo_tool.py 需要的函式。
    依 bone_en 查 BoneDB dbo.Bone_Info，回傳 (bone_zh, bone_en) 或 None
    """
    if not bone_en:
        return None

    sql = """
    SELECT TOP 1 bone_zh, bone_en
    FROM dbo.Bone_Info
    WHERE bone_en = ?
    """
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, bone_en)
        row = cur.fetchone()
        if not row:
            return None
        return row[0], row[1]


# =========================
# Legacy S2 Adapters (Chat/Conversations) - aligned to your schema
#
# agent.Conversation columns:
#   ConversationId (uniqueidentifier) NOT NULL
#   UserId (nvarchar) NOT NULL
#   Title (nvarchar) NULL
#   Source (nvarchar) NOT NULL
#   CreatedAt (datetime2) NOT NULL
#   UpdatedAt (datetime2) NOT NULL
#
# agent.ConversationMessage columns:
#   MessageId
#   ConversationId
#   Role
#   Content
#   AttachmentsJson
#   MetaJson
#   CreatedAt
# =========================

_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
)

def _is_uuid(s: str) -> bool:
    return bool(s and _UUID_RE.match(s.strip()))

def session_to_conversation_uuid(session_id: str) -> str:
    """
    任意 session_id（demo / user123 / ...）→ 固定 GUID
    - 若本來就是 GUID 字串：normalize 後直接用
    - 否則用 uuid5 產生 deterministic GUID（同 session_id 永遠相同 ConversationId）
    """
    s = (session_id or "").strip()
    if not s:
        raise ValueError("session_id is empty")

    if _is_uuid(s):
        return str(uuid.UUID(s))

    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"BoneOrthoSystem:{s}"))

def ensure_conversation_exists(conversation_id: str, user_id: str, source: str = "s2x") -> None:
    """
    確保 agent.Conversation 這筆存在（ConversationMessage 有 FK）
    user_id = 真正的使用者（guest / s1-xxx / ...）
    """
    sql = """
    IF NOT EXISTS (SELECT 1 FROM agent.Conversation WHERE ConversationId = ?)
    BEGIN
        INSERT INTO agent.Conversation (ConversationId, UserId, Title, Source, CreatedAt, UpdatedAt)
        VALUES (?, ?, NULL, ?, SYSUTCDATETIME(), SYSUTCDATETIME())
    END
    """
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, conversation_id, conversation_id, user_id, source)
        conn.commit()


def touch_conversation(conversation_id: str) -> None:
    sql = "UPDATE agent.Conversation SET UpdatedAt = SYSUTCDATETIME() WHERE ConversationId = ?"
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, conversation_id)
        conn.commit()


# ---- Conversations API adapters ----

def create_conversation(user_id: str, title: Optional[str] = None, source: str = "s2x") -> str:
    """
    建立新聊天室，回傳 ConversationId (GUID string)
    """
    conv_id = str(uuid.uuid4())
    sql = """
    INSERT INTO agent.Conversation (ConversationId, UserId, Title, Source, CreatedAt, UpdatedAt)
    VALUES (?, ?, ?, ?, SYSUTCDATETIME(), SYSUTCDATETIME());
    """
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, conv_id, user_id, title, source)
        conn.commit()
    return conv_id

def list_conversations(user_id: str) -> List[Dict[str, Any]]:
    sql = """
    SELECT ConversationId, UserId, Title, Source, CreatedAt, UpdatedAt
    FROM agent.Conversation
    WHERE UserId = ?
    ORDER BY UpdatedAt DESC, CreatedAt DESC;
    """
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, user_id)
        cols = [c[0] for c in cur.description]
        rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    return rows

def get_conversation_messages(conversation_id: str) -> List[Dict[str, Any]]:
    """
    conversation_id 可能是 GUID，也可能是 session_id（demo/user123）
    """
    conv_id = session_to_conversation_uuid(str(conversation_id))

    sql = """
    SELECT MessageId, ConversationId, Role, Content, AttachmentsJson, MetaJson, CreatedAt
    FROM agent.ConversationMessage
    WHERE ConversationId = ?
    ORDER BY CreatedAt ASC, MessageId ASC;
    """
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, conv_id)
        cols = [c[0] for c in cur.description]
        rows = [dict(zip(cols, row)) for row in cur.fetchall()]

    # 把 MetaJson parse 出來（如果是合法 JSON）
    for r in rows:
        mj = r.get("MetaJson")
        if mj:
            try:
                r["Meta"] = json.loads(mj)
            except Exception:
                r["Meta"] = None
        else:
            r["Meta"] = None

    return rows


def add_message(
    conversation_id: str,                   # GUID 或 session 字串
    role: str,
    content: str,
    user_id: str = "guest",                 # ✅ 新增：真正的使用者 id
    bone_id: Optional[int] = None,
    small_bone_id: Optional[int] = None,
    sources: Optional[Any] = None,
    attachments_json: Optional[str] = None,
    **kwargs,
) -> str:
    """
    寫入 agent.ConversationMessage
    """

    raw = str(conversation_id)
    conv_id = session_to_conversation_uuid(raw)  # ✅ 保證是 GUID

    # ✅ 這裡才是重點：Conversation.UserId 必須用真正的 user_id
    ensure_conversation_exists(conv_id, user_id=user_id, source="s2x")

    # AttachmentsJson
    attachments_json_out = None
    if attachments_json:
        try:
            json.loads(attachments_json)
            attachments_json_out = attachments_json
        except Exception:
            attachments_json_out = json.dumps({"raw": attachments_json}, ensure_ascii=False)

    # MetaJson
    meta: Dict[str, Any] = {}
    if sources is not None:
        meta["sources"] = sources
    if bone_id is not None:
        meta["bone_id"] = bone_id
    if small_bone_id is not None:
        meta["small_bone_id"] = small_bone_id
    if kwargs:
        meta["extra"] = kwargs

    meta_json_out = json.dumps(meta, ensure_ascii=False) if meta else None

    sql = """
    INSERT INTO agent.ConversationMessage
        (ConversationId, Role, Content, AttachmentsJson, MetaJson, CreatedAt)
    OUTPUT INSERTED.MessageId
    VALUES (?, ?, ?, ?, ?, SYSUTCDATETIME());
    """

    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, conv_id, role, content, attachments_json_out, meta_json_out)
        mid = cur.fetchone()[0]
        conn.commit()

    touch_conversation(conv_id)
    return str(mid)



def update_conversation_title(conversation_id: str, title: str) -> None:
    conv_id = session_to_conversation_uuid(str(conversation_id))
    sql = """
    UPDATE agent.Conversation
    SET Title = ?, UpdatedAt = SYSUTCDATETIME()
    WHERE ConversationId = ?;
    """
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, title, conv_id)
        conn.commit()

def delete_conversation(conversation_id: str) -> None:
    conv_id = session_to_conversation_uuid(str(conversation_id))
    sql1 = "DELETE FROM agent.ConversationMessage WHERE ConversationId = ?;"
    sql2 = "DELETE FROM agent.Conversation WHERE ConversationId = ?;"
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql1, conv_id)
        cur.execute(sql2, conv_id)
        conn.commit()

def get_messages(conversation_id: str):
    # legacy 相容
    return get_conversation_messages(conversation_id)

# db.py
import uuid
import re

_CONV_TITLE_MAX = 60  # 你表 Title 很可能很短，先保守。要加長就改這個 + 改 DB 欄位長度

def _normalize_uuid(s: str | None) -> str | None:
    if not s:
        return None
    raw = str(s).strip()

    # 去掉常見包法
    raw = raw.strip("{}").strip()

    # 允許 32 hex（無連字號）
    if re.fullmatch(r"[0-9a-fA-F]{32}", raw):
        try:
            return str(uuid.UUID(raw))
        except Exception:
            return None

    # 允許標準 GUID
    try:
        return str(uuid.UUID(raw))
    except Exception:
        return None

def _safe_title(seed: str | None) -> str | None:
    if not seed:
        return None
    t = str(seed).replace("\r", " ").replace("\n", " ").strip()
    if not t:
        return None
    return t[:_CONV_TITLE_MAX]

def set_conversation_title_if_empty(conv_id: str, title_seed: str):
    """
    只在 Title 為 NULL/空字串時才更新，並且：
    - conv_id 必須是合法 GUID（uniqueidentifier）
    - title 會被截短避免 2628 截斷錯誤
    """
    cid = _normalize_uuid(conv_id)
    if not cid:
        print(f"⚠️ set_conversation_title_if_empty skip: invalid conv_id = {conv_id!r}")
        return

    title = _safe_title(title_seed)
    if not title:
        return

    sql = """
    UPDATE agent.Conversation
    SET Title =
        CASE
            WHEN Title IS NULL OR LTRIM(RTRIM(Title)) = '' THEN ?
            ELSE Title
        END,
        UpdatedAt = GETDATE()
    WHERE ConversationId = ?
    """

    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, title, cid)
        conn.commit()
