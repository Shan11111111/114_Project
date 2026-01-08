from __future__ import annotations

import os
import hmac
import hashlib
import secrets

OTP_TTL_MINUTES = int(os.getenv("EMAIL_OTP_TTL_MINUTES", "15"))
OTP_RESEND_COOLDOWN_SECONDS = int(os.getenv("EMAIL_OTP_RESEND_COOLDOWN_SECONDS", "60"))

def generate_otp() -> str:
    # 6 位數 OTP（000000~999999）
    return f"{secrets.randbelow(1_000_000):06d}"

def hash_otp(email: str, code: str) -> bytes:
    """
    用 HMAC-SHA256：hash = HMAC(secret, email|code)
    存 DB 存這個 32 bytes，驗證時同樣算一次比對。
    """
    secret = os.getenv("EMAIL_OTP_SECRET", "dev-secret-change-me").encode("utf-8")
    msg = f"{email.lower()}|{code}".encode("utf-8")
    return hmac.new(secret, msg, hashlib.sha256).digest()
