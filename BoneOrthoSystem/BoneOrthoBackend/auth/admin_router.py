from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from db import get_connection

router = APIRouter(prefix="/auth/admin", tags=["Auth Admin"])

ALLOWED_ROLES = {"student", "teacher", "doctor", "assistant", "manager"}
ALLOWED_STATES = {"pending", "active", "disabled"}


def _norm(v: Optional[str]) -> str:
    return (v or "").strip().lower()


def _require_manager(requester_user_id: str, requester_role: str) -> None:
    if not requester_user_id.strip():
        raise HTTPException(status_code=401, detail="請先登入")
    if _norm(requester_role) != "manager":
        raise HTTPException(status_code=403, detail="只有 manager 可以管理帳號")


class UpdateUserIn(BaseModel):
    requester_user_id: str
    requester_role: str
    role: Optional[str] = None
    state: Optional[str] = None


class DeleteUserIn(BaseModel):
    requester_user_id: str
    requester_role: str


@router.get("/users")
def list_users(
    requester_user_id: str = Query(...),
    requester_role: str = Query(...),
    q: str | None = Query(None),
    top: int = Query(200, ge=1, le=1000),
):
    _require_manager(requester_user_id, requester_role)

    sql = """
    SELECT TOP (?)
        id,
        user_id,
        username,
        email,
        roles,
        states,
        email_verified_at
    FROM dbo.[users]
    WHERE (
        ? IS NULL
        OR username LIKE '%' + ? + '%'
        OR email LIKE '%' + ? + '%'
        OR user_id LIKE '%' + ? + '%'
        OR roles LIKE '%' + ? + '%'
        OR states LIKE '%' + ? + '%'
    )
    ORDER BY id DESC
    """

    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, top, q, q, q, q, q, q)
        cols = [c[0] for c in cur.description]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]

    for r in rows:
        if r.get("email_verified_at") is not None:
            r["email_verified_at"] = str(r["email_verified_at"])

    return {"users": rows}


@router.patch("/users/{target_user_id}")
def update_user(target_user_id: str, body: UpdateUserIn):
    _require_manager(body.requester_user_id, body.requester_role)

    if body.requester_user_id == target_user_id:
        raise HTTPException(status_code=400, detail="不可修改自己的帳號角色或狀態")

    role = body.role.strip().lower() if body.role else None
    state = body.state.strip().lower() if body.state else None

    if role is None and state is None:
        raise HTTPException(status_code=400, detail="至少要提供 role 或 state 其中一個")

    if role is not None and role not in ALLOWED_ROLES:
        raise HTTPException(status_code=400, detail=f"role 不允許：{role}")

    if state is not None and state not in ALLOWED_STATES:
        raise HTTPException(status_code=400, detail=f"state 不允許：{state}")

    sets = []
    params = []

    if role is not None:
        sets.append("roles = ?")
        params.append(role)

    if state is not None:
        sets.append("states = ?")
        params.append(state)

    params.append(target_user_id)

    sql = f"""
    UPDATE dbo.[users]
    SET {", ".join(sets)}
    WHERE user_id = ?
    """

    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, *params)
        if cur.rowcount <= 0:
            raise HTTPException(status_code=404, detail="找不到使用者")
        conn.commit()

    return {"ok": True, "user_id": target_user_id, "role": role, "state": state}


@router.delete("/users/{target_user_id}")
def delete_user(target_user_id: str, body: DeleteUserIn):
    _require_manager(body.requester_user_id, body.requester_role)

    if body.requester_user_id == target_user_id:
        raise HTTPException(status_code=400, detail="不可刪除自己的帳號")

    with get_connection() as conn:
        cur = conn.cursor()

        cur.execute("SELECT TOP 1 user_id FROM dbo.[users] WHERE user_id = ?", target_user_id)
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="找不到使用者")

        # 先刪 refresh tokens
        cur.execute("DELETE FROM dbo.user_refresh_tokens WHERE user_id = ?", target_user_id)

        # 若有 email verification 記錄，也一起清
        try:
            cur.execute("DELETE FROM dbo.user_email_verifications WHERE user_id = ?", target_user_id)
        except Exception:
            pass

        cur.execute("DELETE FROM dbo.[users] WHERE user_id = ?", target_user_id)

        if cur.rowcount <= 0:
            raise HTTPException(status_code=404, detail="刪除失敗，找不到使用者")

        conn.commit()

    return {"ok": True, "deleted_user_id": target_user_id}