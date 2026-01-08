# BoneOrthoBackend/auth/models.py
from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, EmailStr, Field, field_validator


class RegisterIn(BaseModel):
    username: str = Field(..., min_length=1, max_length=50)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=256)

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
    code: str = Field(..., min_length=6, max_length=6)


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    user_id: str
    username: Optional[str] = None
    email: Optional[str] = None
    roles: Optional[str] = None
    states: Optional[str] = None
