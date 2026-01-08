# BoneOrthoBackend/auth/router.py
from __future__ import annotations

import os
from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from .models import (
    RegisterIn,
    LoginIn,
    TokenOut,
    UserOut,
    SendVerifyIn,
    VerifyEmailIn,
)
from .security import create_access_token, decode_access_token
from . import repo

router = APIRouter(prefix="/auth", tags=["auth"])

bearer_scheme = HTTPBearer(auto_error=False)


def _client_ip(req: Request):
    xff = req.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return req.client.host if req.client else None


# =========================
# Register / Login
# =========================

@router.post("/register", response_model=UserOut)
def register(payload: RegisterIn):
    existed = repo.get_user_by_email(payload.email)
    if existed:
        raise HTTPException(status_code=409, detail="Email 已被註冊")

    try:
        user = repo.create_user(payload.username, payload.email, payload.password)
    except ValueError as e:
        # bcrypt 72 bytes 或其他密碼規則錯誤
        raise HTTPException(status_code=422, detail=str(e))

    # ✅ 註冊完先發驗證碼（dev 可直接回傳 code 方便測試）
    dev_return = os.getenv("AUTH_DEV_RETURN_CODE", "1") == "1"
    code = repo.create_email_verification(payload.email)
    if dev_return:
        # 你要做「翻書 UI」也可以把 code 顯示在右頁當彩蛋（dev 模式）
        return UserOut(**user)  # 註冊成功先回 user，code 走 /send-verify 也行

    return UserOut(**user)


@router.post("/login", response_model=TokenOut)
def login(req: Request, payload: LoginIn):
    user = repo.check_login(payload.email, payload.password)
    if not user:
        raise HTTPException(status_code=401, detail="帳號或密碼錯誤")

    # ✅ 未驗證 / 非 active
    if user.get("_login_blocked") == "state_not_active":
        raise HTTPException(status_code=403, detail="此帳號尚未完成 Email 驗證")

    repo.mark_last_login(user["user_id"])

    access = create_access_token({"sub": user["user_id"], "roles": user.get("roles") or "user"})
    refresh = repo.issue_refresh_token(
        user_id=user["user_id"],
        created_ip=_client_ip(req),
        user_agent=req.headers.get("user-agent"),
    )
    return TokenOut(access_token=access, refresh_token=refresh)


# =========================
# ✅ 你要的兩支 Email 驗證 API
# =========================

@router.post("/send-verify")
def send_verify(req: Request, payload: SendVerifyIn):
    """
    重新寄送 / 重新產生驗證碼（會寫入 dbo.user_email_verifications）
    開發模式：可回傳 code 方便你測試
    """
    try:
        code = repo.create_email_verification(payload.email)
    except ValueError:
        # 為避免 email 枚舉，這裡也可以永遠回 ok: True
        raise HTTPException(status_code=404, detail="找不到此 email 對應的使用者")

    dev_return = os.getenv("AUTH_DEV_RETURN_CODE", "1") == "1"
    if dev_return:
        return {"ok": True, "dev_code": code, "note": "dev 模式回傳驗證碼，正式上線請關掉 AUTH_DEV_RETURN_CODE"}

    return {"ok": True}


@router.post("/verify")
def verify_email(payload: VerifyEmailIn):
    """
    驗證 email + code
    成功會把 users.states 改成 active，並把該筆 code 標記 used_at
    """
    ok = repo.verify_email_code(payload.email, payload.code)
    if not ok:
        raise HTTPException(status_code=400, detail="驗證碼錯誤或已過期")
    return {"ok": True}


# =========================
# Token ops
# =========================

@router.post("/logout")
def logout(payload: dict):
    rt = payload.get("refresh_token")
    if not rt:
        raise HTTPException(status_code=400, detail="缺少 refresh_token")

    ok = repo.revoke_refresh_token(rt)
    if not ok:
        raise HTTPException(status_code=400, detail="refresh_token 不存在或已撤銷")

    return {"ok": True}


@router.post("/refresh", response_model=TokenOut)
def refresh(payload: dict):
    rt = payload.get("refresh_token")
    if not rt:
        raise HTTPException(status_code=400, detail="缺少 refresh_token")

    user_id = repo.validate_refresh_token(rt)
    if not user_id:
        raise HTTPException(status_code=401, detail="refresh_token 無效或已過期")

    access = create_access_token({"sub": user_id})
    return TokenOut(access_token=access, refresh_token=rt)


@router.get("/me", response_model=UserOut)
def me(creds: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    if not creds or creds.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="缺少 Bearer token")

    token = creds.credentials
    data = decode_access_token(token)
    if not data or not data.get("sub"):
        raise HTTPException(status_code=401, detail="access_token 無效")

    user = repo.get_user_by_id(data["sub"])
    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在")

    return UserOut(**user)
