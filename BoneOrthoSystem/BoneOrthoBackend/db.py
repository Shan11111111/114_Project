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
# S2 legacy needs (YOLO label -> DB name)
# =========================
def get_bone_zh_en_by_en(bone_en: str):
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
# =========================
_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
)

def _is_uuid(s: str) -> bool:
    return bool(s and _UUID_RE.match(s.strip()))

def session_to_conversation_uuid(session_id: str) -> str:
    """
    任意 session_id（demo / user123 / GUID / ...）→ 固定 GUID
    - 若本來就是 GUID：normalize 後直接用
    - 否則用 uuid5 deterministic（同 session_id 永遠相同 ConversationId）
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
    ✅ 並補救以前把 UserId 寫成 GUID/session 的災難
    """
    sql = """
    IF EXISTS (SELECT 1 FROM agent.Conversation WHERE ConversationId = ?)
    BEGIN
        UPDATE agent.Conversation
        SET UserId = CASE
            WHEN UserId IS NULL OR LTRIM(RTRIM(UserId)) = '' OR UserId = CONVERT(nvarchar(36), ConversationId)
            THEN ?
            ELSE UserId
        END,
        UpdatedAt = SYSUTCDATETIME()
        WHERE ConversationId = ?;
    END
    ELSE
    BEGIN
        INSERT INTO agent.Conversation (ConversationId, UserId, Title, Source, CreatedAt, UpdatedAt)
        VALUES (?, ?, NULL, ?, SYSUTCDATETIME(), SYSUTCDATETIME());
    END
    """
    with get_connection() as conn:
        cur = conn.cursor()
        # placeholders: 1)exists id, 2)user_id, 3)update where id, 4)insert id, 5)insert user, 6)source
        cur.execute(sql, conversation_id, user_id, conversation_id, conversation_id, user_id, source)
        conn.commit()

def touch_conversation(conversation_id: str) -> None:
    sql = "UPDATE agent.Conversation SET UpdatedAt = SYSUTCDATETIME() WHERE ConversationId = ?"
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, conversation_id)
        conn.commit()


# ---- Conversations API adapters ----
def create_conversation(user_id: str, title: Optional[str] = None, source: str = "s2x") -> str:
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
    conversation_id: str,                   # ✅ 可收 session_id 或 GUID
    role: str,
    content: str,
    user_id: str = "guest",
    source: str = "s2x",
    bone_id: Optional[int] = None,          # 表沒欄位 → 放 MetaJson
    small_bone_id: Optional[int] = None,    # 表沒欄位 → 放 MetaJson
    sources: Optional[Any] = None,          # 放 MetaJson
    attachments_json: Optional[str] = None, # 放 AttachmentsJson（字串 JSON）
    **kwargs,
) -> str:
    raw = str(conversation_id)
    conv_id = session_to_conversation_uuid(raw)

    ensure_conversation_exists(conv_id, user_id=user_id, source=source)

    # 1) AttachmentsJson：保持 JSON 字串；不是 JSON 就包 raw
    attachments_json_out = None
    if attachments_json:
        try:
            json.loads(attachments_json)
            attachments_json_out = attachments_json
        except Exception:
            attachments_json_out = json.dumps({"raw": attachments_json}, ensure_ascii=False)

    # 2) MetaJson：sources + bone_id/small_bone_id + extra
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
    return get_conversation_messages(conversation_id)


# =========================
# Title helper: avoid truncation
# =========================
_CONV_TITLE_MAX = 60

def _normalize_uuid(s: str | None) -> str | None:
    if not s:
        return None
    raw = str(s).strip().strip("{}").strip()
    if re.fullmatch(r"[0-9a-fA-F]{32}", raw):
        try:
            return str(uuid.UUID(raw))
        except Exception:
            return None
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
        UpdatedAt = SYSUTCDATETIME()
    WHERE ConversationId = ?
    """

    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, title, cid)
        conn.commit()
