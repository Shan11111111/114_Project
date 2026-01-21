# BoneOrthoBackend/auth/models.py
from __future__ import annotations

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr, Field, field_validator, AliasChoices

# ✅ 允許的角色白名單
ALLOWED_ROLES = {"user", "student", "teacher", "doctor", "assistant"}

class RegisterIn(BaseModel):
    username: str = Field(..., min_length=1, max_length=50)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=256)

    # ✅ 你要的是 role（但相容 roles）
    role: str = Field(
        default="user",
        validation_alias=AliasChoices("role", "roles"),
        description="Requested role (API uses role; DB column is roles).",
    )

    @field_validator("role")
    @classmethod
    def role_whitelist(cls, v: str) -> str:
        vv = (v or "user").strip().lower()
        if vv not in ALLOWED_ROLES:
            raise ValueError(f"role 不允許：{vv}（僅允許 {sorted(ALLOWED_ROLES)}）")
        return vv

    @field_validator("password")
    @classmethod
    def password_within_72_bytes(cls, v: str) -> str:
        if len(v.encode("utf-8")) > 72:
            raise ValueError("密碼太長：bcrypt 限制最多 72 bytes（英文約 72 字；中文大約 24 字內）。")
        return v


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class SendVerifyIn(BaseModel):
    email: EmailStr


class VerifyEmailIn(BaseModel):
    email: EmailStr
    code: str = Field(..., min_length=4, max_length=12)


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: Optional[int] = None          # ✅ 新增：users.id (int)
    user_id: str                      # uuid string（原本保留）
    username: Optional[str] = None
    email: Optional[str] = None
    roles: Optional[str] = None
    states: Optional[str] = None
    email_verified_at: Optional[datetime] = None
