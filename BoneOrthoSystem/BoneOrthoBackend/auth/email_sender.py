# BoneOrthoBackend/auth/email_sender.py
from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage
from datetime import datetime

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
SMTP_FROM = os.getenv("SMTP_FROM", SMTP_USER or "no-reply@example.com")

def send_verify_email(to_email: str, code: str, expires_at: datetime):
    """
    ✅ 背景發送：register/send-verify 會 BackgroundTasks 呼叫。
    沒設定 SMTP 就只 print（方便你 demo）。
    """
    subject = "[GalaBone] Email 驗證碼"
    body = (
        f"你的 GalaBone 驗證碼是：{code}\n\n"
        f"有效期限到（UTC）：{expires_at}\n"
        f"若非本人操作請忽略。\n"
    )

    if not SMTP_HOST or not SMTP_USER or not SMTP_PASS:
        print(f"📨 [DEV] send email to={to_email} code={code} exp={expires_at}")
        return

    msg = EmailMessage()
    msg["From"] = SMTP_FROM
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body)

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as s:
        s.starttls()
        s.login(SMTP_USER, SMTP_PASS)
        s.send_message(msg)
