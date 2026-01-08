from __future__ import annotations

import os
import smtplib
import ssl
from email.message import EmailMessage

def send_email(to_email: str, subject: str, text: str) -> None:
    """
    兩種模式：
    1) EMAIL_MODE=console：不真的寄，直接 print（demo 最穩）
    2) EMAIL_MODE=smtp：走 SMTP
    """
    mode = os.getenv("EMAIL_MODE", "console").lower().strip()

    if mode == "console":
        print("\n==== [DEV EMAIL] ====")
        print("TO:", to_email)
        print("SUBJECT:", subject)
        print(text)
        print("=====================\n")
        return

    # SMTP 模式
    host = os.getenv("SMTP_HOST", "")
    port = int(os.getenv("SMTP_PORT", "465"))
    user = os.getenv("SMTP_USER", "")
    password = os.getenv("SMTP_PASS", "")
    from_email = os.getenv("SMTP_FROM", user)

    if not host or not user or not password:
        raise RuntimeError("SMTP 參數不足，請設定 SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM 或改用 EMAIL_MODE=console")

    msg = EmailMessage()
    msg["From"] = from_email
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(text)

    context = ssl.create_default_context()
    with smtplib.SMTP_SSL(host, port, context=context) as server:
        server.login(user, password)
        server.send_message(msg)
