# app/db.py
import pyodbc

DRIVER_NAME = "ODBC Driver 18 for SQL Server"

CONN_STR = (
    f"DRIVER={{{DRIVER_NAME}}};"
    "SERVER=localhost;"
    "DATABASE=BoneDB;"
    "Trusted_Connection=yes;"
    "Encrypt=yes;"
    "TrustServerCertificate=yes;"
)


def get_connection():
    """回傳一個已連線的 pyodbc connection。用 with 管理。"""
    return pyodbc.connect(CONN_STR)
