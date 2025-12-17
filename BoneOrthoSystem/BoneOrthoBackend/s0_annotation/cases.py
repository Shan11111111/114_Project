# BoneOrthoBackend/s0_annotation/cases.py
from fastapi import APIRouter

router = APIRouter(prefix="/s0", tags=["s0_cases"])


@router.get("/cases/pending")
def get_pending_cases():
    """
    暫時先硬編一筆案例，讓前端 /s0 可以看到實際圖片。
    之後你可以改成從 vision.ImageCase 撈資料。
    """
    return [
        {
            "image_case_id": 6,
            # 這裡先走「前端自己的 public/bone_images」
            # 圖片放在：frontend/public/bone_images/a779cf00b3614f82afc75eb6c0c6bd44.png
            "image_url": "/bone_images/a779cf00b3614f82afc75eb6c0c6bd44.png",
            "thumbnail_url": "/bone_images/a779cf00b3614f82afc75eb6c0c6bd44.png",
            "created_at": "2025-12-12T00:00:00",
        }
    ]
