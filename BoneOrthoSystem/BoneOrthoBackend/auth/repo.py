# BoneOrthoBackend/auth/repo.py
from __future__ import annotations

from datetime import timedelta
from typing import Optional, Dict, Any
from uuid import uuid4
import os
import secrets
import hashlib

from db import query_one, execute  # ✅ 用你現有的 db.py
from .security import (
    hash_password,
    verify_password,
    create_refresh_token,
    hash_refresh_token,
    utcnow,
    REFRESH_TOKEN_EXPIRE_DAYS,
)

VERIFY_CODE_EXPIRE_MINUTES = int(os.getenv("AUTH_VERIFY_EXPIRE_MINUTES", "10"))


def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    return query_one(
        """
        SELECT TOP 1 user_id, username, email, roles, states, password_hash
        FROM dbo.[users]
        WHERE email = ?
        """,
        [email],
    )


def get_user_by_id(user_id: str) -> Optional[Dict[str, Any]]:
    return query_one(
        """
        SELECT TOP 1 user_id, username, email, roles, states
        FROM dbo.[users]
        WHERE user_id = ?
        """,
        [user_id],
    )


def create_user(username: str, email: str, password: str) -> Dict[str, Any]:
    user_id = str(uuid4())
    pw_hash = hash_password(password)

    # ✅ 建議：註冊後先 pending，驗證成功才 active
    execute(
        """
        INSERT INTO dbo.[users] (user_id, username, email, roles, states, password_hash)
        VALUES (?, ?, ?, 'user', 'pending', ?)
        """,
        [user_id, username, email, pw_hash],
    )

    return {
        "user_id": user_id,
        "username": username,
        "email": email,
        "roles": "user",
        "states": "pending",
    }


def mark_last_login(user_id: str) -> None:
    execute(
        "UPDATE dbo.[users] SET last_login_at = SYSUTCDATETIME() WHERE user_id = ?",
        [user_id],
    )


def check_login(email: str, password: str) -> Optional[Dict[str, Any]]:
    user = get_user_by_email(email)
    if not user:
        return None

    st = (user.get("states") or "active").lower()
    if st != "active":
        # 讓 router 決定要不要丟「未驗證」的訊息
        return user | {"_login_blocked": "state_not_active"}  # type: ignore

    if not verify_password(password, user.get("password_hash") or ""):
        return None
    return user


def issue_refresh_token(user_id: str, created_ip: Optional[str], user_agent: Optional[str]) -> str:
    refresh = create_refresh_token()
    token_hash = hash_refresh_token(refresh)
    expires_at = (utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)).replace(tzinfo=None)

    execute(
        """
        INSERT INTO dbo.user_refresh_tokens (user_id, token_hash, expires_at, created_ip, user_agent)
        VALUES (?, ?, ?, ?, ?)
        """,
        [user_id, token_hash, expires_at, created_ip, user_agent],
    )
    return refresh


def revoke_refresh_token(refresh_token: str) -> bool:
    token_hash = hash_refresh_token(refresh_token)
    n = execute(
        """
        UPDATE dbo.user_refresh_tokens
        SET revoked_at = SYSUTCDATETIME()
        WHERE token_hash = ? AND revoked_at IS NULL
        """,
        [token_hash],
    )
    return n > 0


def validate_refresh_token(refresh_token: str) -> Optional[str]:
    token_hash = hash_refresh_token(refresh_token)
    now = utcnow().replace(tzinfo=None)
    row = query_one(
        """
        SELECT TOP 1 user_id
        FROM dbo.user_refresh_tokens
        WHERE token_hash = ?
          AND revoked_at IS NULL
          AND expires_at > ?
        """,
        [token_hash, now],
    )
    return row["user_id"] if row else None


# =========================
# Email Verification
# =========================

def _hash_verify_code(email: str, code: str) -> bytes:
    # ✅ 固定 hash：避免彩虹表 + 綁 email
    raw = (email.strip().lower() + ":" + code.strip()).encode("utf-8")
    return hashlib.sha256(raw).digest()


def create_email_verification(email: str) -> str:
    """
    產生 6 位數驗證碼，存 hash 到 dbo.user_email_verifications
    回傳「明碼 code」給 router（dev 模式可以回傳給前端/Swagger）
    """
    user = get_user_by_email(email)
    if not user:
        # 為了避免枚舉 email，也可以改成直接 return 假碼不做事
        raise ValueError("找不到此 email 對應的使用者")

    c
