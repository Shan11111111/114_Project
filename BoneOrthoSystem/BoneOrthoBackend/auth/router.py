# BoneOrthoBackend/auth/router.py
from __future__ import annotations

import os
from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from .models import (
    RegisterIn, LoginIn, TokenOut, UserOut,
    SendVerifyIn, VerifyEmailIn,
)
from .security import create_access_token, decode_access_token
from . import repo

router = APIRouter(prefix="/auth", tags=["auth"])
bearer_scheme = HTTPBearer(auto_error=False)

AUTH_DEV_RETURN_CODE = os.getenv("AUTH_DEV_RETURN_CODE", "1") == "1"


def _client_ip(req: Request):
    xff = req.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return req.client.host if req.client else None


@router.post("/register", response_model=UserOut)
def register(payload: RegisterIn):
    existed = repo.get_user_by_email(payload.email)
    if existed:
        raise HTTPException(status_code=409, detail="Email 已被註冊")

    try:
        user = repo.create_user(
            username=payload.username,
            email=payload.email,
            password=payload.password,
            role=payload.role,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    return UserOut(**user)


@router.post("/login", response_model=TokenOut)
def login(req: Request, payload: LoginIn):
    user = repo.check_login(payload.email, payload.password)
    if not user:
        raise HTTPException(status_code=401, detail="帳號或密碼錯誤，或帳號狀態不可用")

    if user.get("_login_blocked") == "state_not_active":
        raise HTTPException(status_code=403, detail="此帳號尚未完成 Email 驗證")

    # ✅ refresh token 還是用 user_id(uuid)（不要動）
    repo.mark_last_login(user["user_id"])
    refresh = repo.issue_refresh_token(
        user_id=user["user_id"],
        created_ip=_client_ip(req),
        user_agent=req.headers.get("user-agent"),
    )

    # ✅ access token：sub 改成 int id，並保留 user_id 讓你相容舊資料
    access = create_access_token({
        "sub": user["id"],  # ✅ int
        "user_id": user["user_id"],  # ✅ legacy uuid
        "roles": user.get("roles") or "user",
    })

    return TokenOut(access_token=access, refresh_token=refresh)


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

    # ✅ refresh token -> user_id(uuid)
    user_id = repo.validate_refresh_token(rt)
    if not user_id:
        raise HTTPException(status_code=401, detail="refresh_token 無效或已過期")

    # ✅ 再查 user 取得 int id，簽新 access
    u = repo.get_user_by_id(user_id)
    if not u:
        raise HTTPException(status_code=404, detail="使用者不存在")

    access = create_access_token({
        "sub": u["id"],          # ✅ int
        "user_id": u["user_id"], # ✅ uuid
        "roles": u.get("roles") or "user",
    })

    return TokenOut(access_token=access, refresh_token=rt)


@router.get("/me", response_model=UserOut)
def me(creds: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    if not creds or creds.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="缺少 Bearer token")

    data = decode_access_token(creds.credentials)
    if not data:
        raise HTTPException(status_code=401, detail="access_token 無效")

    sub = data.get("sub")
    user = None

    # ✅ sub 可能是：int、"123"、uuid
    if sub is not None:
        sub_str = str(sub)

        # 1) "123" / 123 -> 當 users.id(int) 查
        if sub_str.isdigit():
            user = repo.get_user_by_int_id(int(sub_str))
        else:
            # 2) uuid -> 當 users.user_id(uuid string) 查
            user = repo.get_user_by_id(sub_str)

    # ✅ 再保險：token 同時帶 user_id 就用它補救
    if not user and data.get("user_id"):
        user = repo.get_user_by_id(str(data["user_id"]))

    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在")

    return UserOut(**user)



# =========================
# Email Verify APIs
# =========================

@router.post("/send-verify")
def send_verify(payload: SendVerifyIn):
    try:
        code = repo.create_email_verification(payload.email)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if AUTH_DEV_RETURN_CODE:
        return {"ok": True, "dev_code": code}
    return {"ok": True}


@router.post("/verify")
def verify_email(payload: VerifyEmailIn):
    ok = repo.verify_email_code(payload.email, payload.code)
    if not ok:
        raise HTTPException(status_code=400, detail="驗證碼錯誤或已過期")
    return {"ok": True}

# 在 router.py 最下面 Email Verify APIs 區塊加這兩個

@router.post("/email/send")
def send_verify_alias(payload: SendVerifyIn):
    return send_verify(payload)

@router.post("/email/verify")
def verify_email_alias(payload: VerifyEmailIn):
    return verify_email(payload)
