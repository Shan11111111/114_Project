# BoneOrthoSystem/shared/db.py
import pyodbc

# 依照實際情況調整 DRIVER / SERVER / DATABASE
DRIVER_NAME = "ODBC Driver 18 for SQL Server"
CONN_STR = (
    f"DRIVER={{{DRIVER_NAME}}};"
    "SERVER=140.136.155.157:2676;"        # 如果是遠端 IP，就改成 192.168.x.x,1433 之類
    "DATABASE=BoneDB;"
    "Trusted_Connection=yes;"  # 如果你們是 Windows 驗證就保留
    "Encrypt=yes;"
    "TrustServerCertificate=yes;"
)


def get_conn():
    """
    回傳一個 pyodbc 的連線物件。
    用法範例：
        with get_conn() as conn:
            cursor = conn.cursor()
            ...
    """
    return pyodbc.connect(CONN_STR)
