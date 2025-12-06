# db.py
import pyodbc

# ==========================================
# DB 連線設定
# ==========================================
CONN_STR = (
    "DRIVER={ODBC Driver 17 for SQL Server};"
    "SERVER=localhost;"          # 之後如果是遠端 → 改 IP 或 主機名稱
    "DATABASE=BoneDB;"
    "Trusted_Connection=yes;"
)

def get_connection():
    """
    建立並回傳一個新的 SQL Server 連線
    使用完記得在呼叫端關閉：conn.close()
    （或用 try/finally 包起來）
    """
    return pyodbc.connect(CONN_STR)
