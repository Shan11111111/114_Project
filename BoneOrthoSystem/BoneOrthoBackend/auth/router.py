# BoneOrthoBackend/auth/router.py
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from .models import RegisterIn, LoginIn, TokenOut, UserOut
from .security import create_access_token, decode_access_token
from . import repo

router = APIRouter(prefix="/auth", tags=["auth"])

# ✅ 改成 Bearer token（Swagger 會變成貼 token 的 UI）
bearer_scheme = HTTPBearer(auto_error=False)


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
        user = repo.create_user(payload.username, payload.email, payload.password)
    except ValueError as e:
        # bcrypt 72 bytes 或其他密碼規則錯誤
        raise HTTPException(status_code=422, detail=str(e))

    return UserOut(**user)


@router.post("/login", response_model=TokenOut)
def login(req: Request, payload: LoginIn):
    user = repo.check_login(payload.email, payload.password)
    if not user:
        raise HTTPException(status_code=401, detail="帳號或密碼錯誤，或帳號狀態不可用")

    repo.mark_last_login(user["user_id"])

    access = create_access_token({"sub": user["user_id"], "roles": user.get("roles") or "user"})
    refresh = repo.issue_refresh_token(
        user_id=user["user_id"],
        created_ip=_client_ip(req),
        user_agent=req.headers.get("user-agent"),
    )
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
