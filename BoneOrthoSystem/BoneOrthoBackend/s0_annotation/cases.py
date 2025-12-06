# BoneOrthoBackend/s0_annotation/cases.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from db import query_all, execute

router = APIRouter(prefix="/s0", tags=["s0_cases"])

class ImageCaseCreate(BaseModel):
    userId: Optional[str] = None
    source: str = "s0_annotation"
    imagePath: str        # 先假設你前端存一個檔名或 URL

class ImageCaseOut(BaseModel):
    imageCaseId: int
    userId: Optional[str]
    source: str
    imagePath: str

@router.post("/cases", response_model=ImageCaseOut)
def create_case(payload: ImageCaseCreate):
    """
    建立一個 ImageCase，外加一筆 imagePath 紀錄
    下面的表名你可以依自己真的 DB 再調整
    """
    # 建 ImageCase
    sql_case = """
    INSERT INTO vision.ImageCase (UserId, Source, CreatedAt)
    OUTPUT INSERTED.ImageCaseId
    VALUES (?, ?, SYSDATETIME());
    """
    rows = query_all(sql_case, [payload.userId, payload.source])
    if not rows:
        raise HTTPException(status_code=500, detail="建立 ImageCase 失敗")
    image_case_id = rows[0]["ImageCaseId"]

    # 紀錄圖片路徑（這張表如果你沒有，就先註解掉）
    sql_img = """
    INSERT INTO vision.ImageSource (ImageCaseId, ImagePath, CreatedAt)
    VALUES (?, ?, SYSDATETIME());
    """
    try:
        execute(sql_img, [image_case_id, payload.imagePath])
    except Exception:
        # 你可以改成 log，下次再修
        pass

    return ImageCaseOut(
        imageCaseId=image_case_id,
        userId=payload.userId,
        source=payload.source,
        imagePath=payload.imagePath,
    )

@router.get("/cases/{case_id}", response_model=ImageCaseOut)
def get_case(case_id: int):
    sql = """
    SELECT TOP 1 c.ImageCaseId, c.UserId, c.Source,
           s.ImagePath
    FROM vision.ImageCase c
    LEFT JOIN vision.ImageSource s ON c.ImageCaseId = s.ImageCaseId
    WHERE c.ImageCaseId = ?
    """
    rows = query_all(sql, [case_id])
    if not rows:
        raise HTTPException(status_code=404, detail="找不到該 ImageCase")
    r = rows[0]
    return ImageCaseOut(
        imageCaseId=r["ImageCaseId"],
        userId=r["UserId"],
        source=r["Source"],
        imagePath=r["ImagePath"],
    )
