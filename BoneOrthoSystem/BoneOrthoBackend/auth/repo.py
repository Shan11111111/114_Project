# BoneOrthoBackend/auth/repo.py
from __future__ import annotations

from datetime import timedelta
from typing import Optional, Dict, Any
from uuid import uuid4

from db import query_one, execute  # ✅ 用你現有的 db.py
from .security import (
    hash_password,
    verify_password,
    create_refresh_token,
    hash_refresh_token,
    utcnow,
    REFRESH_TOKEN_EXPIRE_DAYS,
)

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

    execute(
        """
        INSERT INTO dbo.[users] (user_id, username, email, roles, states, password_hash)
        VALUES (?, ?, ?, 'user', 'active', ?)
        """,
        [user_id, username, email, pw_hash],
    )

    return {
        "user_id": user_id,
        "username": username,
        "email": email,
        "roles": "user",
        "states": "active",
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
    if (user.get("states") or "active") != "active":
        return None
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
    # rowcount 由 execute 回傳
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
