import os
import json
import re
import uuid
from typing import Optional, List, Dict, Any, Iterable, Sequence, Tuple, Callable

import pyodbc

# =========================
# SQL Server Connection
# =========================
DRIVER_NAME = os.getenv("MSSQL_DRIVER", "ODBC Driver 18 for SQL Server")
SERVER = os.getenv("MSSQL_SERVER", "localhost")
DATABASE = os.getenv("MSSQL_DATABASE", "BoneDB")
TRUSTED = os.getenv("MSSQL_TRUSTED", "yes")  # Windows 驗證

# 額外常用參數
MSSQL_TIMEOUT = int(os.getenv("MSSQL_TIMEOUT", "30"))

CONN_STR = (
    f"DRIVER={{{DRIVER_NAME}}};"
    f"SERVER={SERVER};"
    f"DATABASE={DATABASE};"
    f"Trusted_Connection={TRUSTED};"
    "Encrypt=yes;"
    "TrustServerCertificate=yes;"
)

def get_connection() -> pyodbc.Connection:
    # autocommit 預設 False（我們自己 commit）
    return pyodbc.connect(CONN_STR, timeout=MSSQL_TIMEOUT, autocommit=False)

# ✅ 相容舊碼（有人會 import get_conn）
def get_conn() -> pyodbc.Connection:
    return get_connection()


# -------------------------
# Small utils
# -------------------------
def _params(p):
    # 允許 params=None、list、tuple
    return [] if p is None else p


def query_all(sql: str, params=None) -> List[Dict[str, Any]]:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, _params(params))
        cols = [c[0] for c in cur.description] if cur.description else []
        rows = cur.fetchall()
        return [dict(zip(cols, r)) for r in rows]


def query_one(sql: str, params=None) -> Optional[Dict[str, Any]]:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, _params(params))
        row = cur.fetchone()
        if not row:
            return None
        cols = [c[0] for c in cur.description] if cur.description else []
        return dict(zip(cols, row))


def execute(sql: str, params=None) -> int:
    """
    單條 SQL（INSERT/UPDATE/DELETE），一條連線一次 commit。
    ✅ 保持你原本行為，舊 router 不用改。
    """
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, _params(params))
        conn.commit()
        return cur.rowcount


def execute_many(sql: str, params_list: Sequence[Sequence], fast: bool = True) -> int:
    """
    ✅ executemany：大量 insert/update 最快
    params_list: [(...), (...)] 或 [[...], [...]] 都可
    """
    if not params_list:
        return 0
    with get_connection() as conn:
        cur = conn.cursor()
        if fast:
            cur.fast_executemany = True
        cur.executemany(sql, params_list)
        conn.commit()
        return cur.rowcount


def run_in_transaction(
    ops: Callable[[pyodbc.Cursor], None],
) -> None:
    """
    ✅ 交易工具：同一連線內執行多段 SQL，一次 commit
    用法：
      def ops(cur):
         cur.execute("DELETE ...", ...)
         cur.executemany("INSERT ...", params_list)
      run_in_transaction(ops)
    """
    with get_connection() as conn:
        cur = conn.cursor()
        try:
            ops(cur)
            conn.commit()
        except Exception:
            conn.rollback()
            raise


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
    s = (session_id or "").strip()
    if not s:
        raise ValueError("session_id is empty")

    if _is_uuid(s):
        return str(uuid.UUID(s))

    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"BoneOrthoSystem:{s}"))

def ensure_conversation_exists(conversation_id: str, user_id: str, source: str = "s2x") -> None:
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
        cur.execute(sql, conversation_id, user_id, conversation_id, conversation_id, user_id, source)
        conn.commit()

def touch_conversation(conversation_id: str) -> None:
    sql = "UPDATE agent.Conversation SET UpdatedAt = SYSUTCDATETIME() WHERE ConversationId = ?"
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, conversation_id)
        conn.commit()

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
    conversation_id: str,
    role: str,
    content: str,
    user_id: str = "guest",
    bone_id: Optional[int] = None,
    small_bone_id: Optional[int] = None,
    sources: Optional[Any] = None,
    attachments_json: Optional[str] = None,
    **kwargs,
) -> str:
    raw = str(conversation_id)
    conv_id = session_to_conversation_uuid(raw)
    uid = (user_id or "guest").strip() or "guest"
    ensure_conversation_exists(conv_id, user_id=uid, source="s2x")
    # (你原本這裡就沒寫完，我不亂補，以免影響你們 S2 現況)
    return conv_id

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
