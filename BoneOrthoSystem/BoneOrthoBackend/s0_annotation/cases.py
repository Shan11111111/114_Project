# BoneOrthoBackend/s0_annotation/cases.py
from fastapi import APIRouter, HTTPException

from db import query_all

router = APIRouter(prefix="/s0", tags=["s0_cases"])


@router.get("/cases/pending")
def get_pending_cases():
    """
    從 vision.ImageCase + dbo.Bone_Images 撈出最近幾筆案例，
    讓前端 /s0 可以看到實際圖片。

    image_path 目前長得像 /public/bone_images/xxxx.png
    前端會用 API_BASE 自動補成 http://127.0.0.1:8000/public/...
    """

    sql = """
    SELECT TOP (20)
        ic.ImageCaseId,
        bi.image_path AS image_url,
        bi.image_path AS thumbnail_url,
        ic.CreatedAt
    FROM [BoneDB].[vision].[ImageCase] AS ic
    JOIN [BoneDB].[dbo].[Bone_Images] AS bi
        ON ic.BoneImageId = bi.image_id
    -- 之後如果要過濾「尚未被標註」可以在這裡加條件
    ORDER BY ic.CreatedAt DESC
    """

    try:
        rows = query_all(sql)
    except Exception as e:
        # 這行會出現在 uvicorn log，可以看到真正錯誤（欄位打錯之類）
        print("[s0] get_pending_cases error:", e)
        raise HTTPException(status_code=500, detail=str(e))

    result = []
    for r in rows:
        # query_all 應該是回 dict：{"ImageCaseId": ..., "image_url": ..., "thumbnail_url": ..., "CreatedAt": ...}
        created_at = r.get("CreatedAt")
        if created_at is not None:
            # 轉成 ISO 字串方便前端使用
            created_at = created_at.isoformat()

        result.append(
            {
                "imageCaseId": r.get("ImageCaseId"),
                "imageUrl": r.get("image_url"),
                "thumbnailUrl": r.get("thumbnail_url") or r.get("image_url"),
                "createdAt": created_at,
            }
        )

    return result
