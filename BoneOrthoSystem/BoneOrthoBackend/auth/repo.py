# BoneOrthoBackend/auth/repo.py
from __future__ import annotations

from datetime import timedelta
from typing import Optional, Dict, Any
from uuid import uuid4
import os
import secrets
import hashlib

from db import query_one, execute
from .security import (
    hash_password,
    verify_password,
    create_refresh_token,
    hash_refresh_token,
    utcnow,
    REFRESH_TOKEN_EXPIRE_DAYS,
)

ALLOWED_ROLES = {"user", "student", "teacher", "doctor", "assistant"}
VERIFY_CODE_EXPIRE_MINUTES = int(os.getenv("AUTH_VERIFY_EXPIRE_MINUTES", "10"))


# ✅ 1) get_user_by_email：多撈 int id
def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    return query_one(
        """
        SELECT TOP 1
            id,              -- ✅ int PK
            user_id, username, email, roles, states, password_hash, email_verified_at
        FROM dbo.[users]
        WHERE email = ?
        """,
        [email],
    )


# ✅ 2) get_user_by_id：多撈 int id
def get_user_by_id(user_id: str) -> Optional[Dict[str, Any]]:
    return query_one(
        """
        SELECT TOP 1
            id,              -- ✅ int PK
            user_id, username, email, roles, states, email_verified_at
        FROM dbo.[users]
        WHERE user_id = ?
        """,
        [user_id],
    )


# ✅ 3) 新增：用 int id 查 user（給 /me 用）
def get_user_by_int_id(user_int_id: int) -> Optional[Dict[str, Any]]:
    return query_one(
        """
        SELECT TOP 1
            id,
            user_id, username, email, roles, states, email_verified_at
        FROM dbo.[users]
        WHERE id = ?
        """,
        [user_int_id],
    )


# ✅ 4) create_user：回傳也帶 id（插入後再查一次）
def create_user(username: str, email: str, password: str, role: str = "user") -> Dict[str, Any]:
    role = (role or "user").strip().lower()
    if role not in ALLOWED_ROLES:
        raise ValueError(f"role 不允許：{role}（僅允許 {sorted(ALLOWED_ROLES)}）")

    user_id = str(uuid4())
    pw_hash = hash_password(password)

    execute(
        """
        INSERT INTO dbo.[users] (user_id, username, email, roles, states, password_hash)
        VALUES (?, ?, ?, ?, 'pending', ?)
        """,
        [user_id, username, email, role, pw_hash],
    )

    row = get_user_by_id(user_id)  # 已包含 id
    return {
        "id": row["id"] if row else None,
        "user_id": user_id,
        "username": username,
        "email": email,
        "roles": role,
        "states": "pending",
        "email_verified_at": None,
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
        user["_login_blocked"] = "state_not_active"
        return user

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
    raw = (email.strip().lower() + ":" + code.strip()).encode("utf-8")
    return hashlib.sha256(raw).digest()


def create_email_verification(email: str) -> str:
    user = get_user_by_email(email)
    if not user:
        raise ValueError("找不到此 email 對應的使用者")

    code = f"{secrets.randbelow(1_000_000):06d}"
    code_hash = _hash_verify_code(email, code)
    expires_at = (utcnow() + timedelta(minutes=VERIFY_CODE_EXPIRE_MINUTES)).replace(tzinfo=None)

    execute(
        """
        INSERT INTO dbo.user_email_verifications
            (verification_id, user_id, email, code_hash, expires_at, used_at, created_at)
        VALUES
            (NEWID(), ?, ?, ?, ?, NULL, SYSUTCDATETIME())
        """,
        [user["user_id"], email, code_hash, expires_at],
    )
    return code


def verify_email_code(email: str, code: str) -> bool:
    now = utcnow().replace(tzinfo=None)

    row = query_one(
        """
        SELECT TOP 1 verification_id, user_id, code_hash
        FROM dbo.user_email_verifications
        WHERE email = ?
          AND used_at IS NULL
          AND expires_at > ?
        ORDER BY created_at DESC
        """,
        [email, now],
    )
    if not row:
        return False

    expect = row["code_hash"]
    got = _hash_verify_code(email, code)

    if isinstance(expect, memoryview):
        expect = expect.tobytes()

    if expect != got:
        return False

    execute(
        """
        UPDATE dbo.user_email_verifications
        SET used_at = SYSUTCDATETIME()
        WHERE verification_id = ? AND used_at IS NULL
        """,
        [row["verification_id"]],
    )

    execute(
        """
        UPDATE dbo.[users]
        SET states = 'active',
            email_verified_at = SYSUTCDATETIME()
        WHERE user_id = ?
        """,
        [row["user_id"]],
    )

    return True
