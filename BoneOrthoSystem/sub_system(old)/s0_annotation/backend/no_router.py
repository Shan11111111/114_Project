# s0_annotation/router.py
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

router = APIRouter()

class SaveAnnotationRequest(BaseModel):
    imageCaseId: int
    smallBoneId: int
    x: float
    y: float
    w: float
    h: float
    note: Optional[str] = None

@router.post("/annotations/save")
async def save_annotation(req: SaveAnnotationRequest):
    """
    S0：標記工具存檔（給標註員用）。
    TODO: 把標註結果寫進你的 S0 專用標註表 / vision.ImageDetection。
    """
    # TODO: DB 寫入
    return {"status": "ok", "imageCaseId": req.imageCaseId}
