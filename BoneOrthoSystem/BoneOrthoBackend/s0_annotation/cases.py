# BoneOrthoBackend/s0_annotation/cases.py
from fastapi import APIRouter
from db import query_all

router = APIRouter(prefix="/s0", tags=["s0_cases"])


@router.get("/cases/pending")
def get_pending_cases():
    """
    回傳「待標註」的影像案例清單，給 /s0 前端用的輪播。

    這裡先用最簡單版：
    直接抓 vision.ImageCase 裡面最新的前 20 筆。
    之後你要加條件（例如沒有 ImageAnnotation 的）再慢慢加。
    """

    sql = """
    SELECT TOP 20
        ic.ImageCaseId      AS image_case_id,
        ic.ImageCaseId      AS image_id,      -- 先用 Id 當作圖片 key
        ic.CreatedAt        AS created_at
    FROM vision.ImageCase ic
    ORDER BY ic.CreatedAt DESC
    """
    rows = query_all(sql)

    # 這裡先只回 Id，前端會自己用 image_case_id 去拼「跟辨識頁面一樣的預覽 URL」
    return [
        {
            "image_case_id": row["image_case_id"],
            "image_url": row["image_id"],        # 先佔位，不真的拿來當 URL 用
            "thumbnail_url": row["image_id"],
            "created_at": row["created_at"],
        }
        for row in rows
    ]
