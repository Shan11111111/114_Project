# BoneOrthoBackend/s0_annotation/cases.py
from fastapi import APIRouter, HTTPException
from db import query_all

router = APIRouter(prefix="/s0", tags=["s0_cases"])


@router.get("/cases/pending")
def get_pending_cases():
    """
    從 vision.ImageCase + dbo.Bone_Images 撈出最近幾筆案例，
    讓前端 /s0 可以看到實際圖片。

    Bone_Images.image_path 現在長得像：
      /public/bone_images/xxxxxxxx.png

    app.py 已經有：
      app.mount("/public", StaticFiles(directory=PUBLIC_DIR), name="public")

    所以前端只要吃 imageUrl="/public/..." 就看得到圖。
    """

    sql = """
    SELECT TOP (20)
        ic.ImageCaseId,
        bi.image_path AS image_url,
        bi.image_path AS thumbnail_url,
        ic.CreatedAt
    FROM vision.ImageCase AS ic
    JOIN dbo.Bone_Images AS bi
        ON ic.BoneImageId = bi.image_id
    ORDER BY ic.CreatedAt DESC;
    """

    try:
        rows = query_all(sql)
    except Exception as e:
        # 不要讓整個後端掛掉，回 500 就好
        print("[s0] get_pending_cases error:", e)
        raise HTTPException(status_code=500, detail=str(e))

    result = []
    for r in rows:
        created_at = r.get("CreatedAt")
        if created_at is not None:
            try:
                created_at = created_at.isoformat()
            except Exception:
                created_at = str(created_at)

        result.append(
            {
                "imageCaseId": r.get("ImageCaseId"),
                "imageUrl": r.get("image_url"),
                "thumbnailUrl": r.get("thumbnail_url") or r.get("image_url"),
                "createdAt": created_at,
            }
        )

    return result
