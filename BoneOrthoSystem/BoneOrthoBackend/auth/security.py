# BoneOrthoBackend/auth/security.py
from __future__ import annotations

import os
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
from uuid import uuid4

from jose import jwt
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
JWT_ALG = os.getenv("JWT_ALG", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "14"))


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ✅ repo.py 需要這兩個（你剛剛刪掉才爆）
def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return pwd_context.verify(plain, hashed)
    except Exception:
        return False


def create_access_token(payload: Dict[str, Any]) -> str:
    exp = utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode = dict(payload or {})

    # ✅ exp 用 timestamp，最不挑庫
    to_encode["exp"] = int(exp.timestamp())

    # ✅ sub 一律字串，避免不同 JWT lib 對 int 行為不一致
    if "sub" in to_encode and to_encode["sub"] is not None:
        to_encode["sub"] = str(to_encode["sub"])

    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALG)


def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    try:
        # ✅ 你環境的 jose 會因 leeway 參數炸，所以不要傳
        return jwt.decode(
            token,
            JWT_SECRET,
            algorithms=[JWT_ALG],
            options={"verify_aud": False},
        )
    except Exception:
        return None


def create_refresh_token() -> str:
    # 高熵 token（給 client 存）
    return f"{uuid4().hex}{uuid4().hex}"


def hash_refresh_token(token: str) -> str:
    # DB 只存 hash
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
