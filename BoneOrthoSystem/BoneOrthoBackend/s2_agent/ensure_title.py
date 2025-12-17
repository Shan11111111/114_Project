# s2_agent/ensure_title.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import os
import pyodbc

router = APIRouter(prefix="/s2/agent", tags=["S2 Agent"])


class EnsureTitleIn(BaseModel):
    conversation_id: str
    image_case_id: int


def _conn():
    # 這些跟你專案一貫的 DB 連線做法一致：沒 env 就用 localhost + Trusted_Connection
    DRIVER = os.getenv("ODBC_DRIVER", "ODBC Driver 18 for SQL Server")
    SERVER = os.getenv("DB_SERVER", "localhost")
    DB = os.getenv("DB_NAME", "BoneDB")

    # env 允許 yes/no
    TRUSTED = os.getenv("DB_TRUSTED", "yes")
    ENCRYPT = os.getenv("DB_ENCRYPT", "yes")
    TRUST_CERT = os.getenv("DB_TRUST_CERT", "yes")

    # timeout 避免卡死（尤其你們有時候遠端桌面/DB 會飄）
    TIMEOUT = int(os.getenv("DB_TIMEOUT", "5"))

    conn_str = (
        f"DRIVER={{{DRIVER}}};"
        f"SERVER={SERVER};"
        f"DATABASE={DB};"
        f"Trusted_Connection={TRUSTED};"
        f"Encrypt={ENCRYPT};"
        f"TrustServerCertificate={TRUST_CERT};"
    )
    return pyodbc.connect(conn_str, timeout=TIMEOUT)


@router.post("/ensure-title")
def ensure_title(body: EnsureTitleIn):
    conv_id = (body.conversation_id or "").strip()
    if not conv_id:
        raise HTTPException(status_code=400, detail="conversation_id is required")

    if not isinstance(body.image_case_id, int) or body.image_case_id <= 0:
        raise HTTPException(status_code=400, detail="image_case_id must be positive int")

    # ✅ Title 固定短字串，避免你又被「截斷」打爆
    title = f"ImageCaseId: {body.image_case_id} 辨識結果"

    try:
        with _conn() as conn:
            cur = conn.cursor()

            # ✅ 用 [] 包 schema/table，避免遇到保留字/奇怪命名時出事
            sql = """
            UPDATE [agent].[Conversation]
            SET [Title] = ?
            WHERE [ConversationId] = ?
              AND ([Title] IS NULL OR LTRIM(RTRIM([Title])) = '')
            """

            cur.execute(sql, title, conv_id)
            # rowcount：有更新到就是 1，沒更新到就是 0（表示本來就有 Title 或找不到 conv_id）
            updated = cur.rowcount
            conn.commit()

        return {"ok": True, "title": title, "updated": int(updated)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ensure-title failed: {e}")
