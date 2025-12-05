# s1_detection/router.py
from fastapi import APIRouter, UploadFile, File
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter()

# --------- Pydantic models ---------
class BBox(BaseModel):
    x: float
    y: float
    w: float
    h: float

class Detection(BaseModel):
    detectionId: int
    boneId: Optional[int] = None
    smallBoneId: Optional[int] = None
    boneZh: Optional[str] = None
    boneEn: Optional[str] = None
    bbox: BBox
    confidence: float

class DetectResponse(BaseModel):
    imageCaseId: int
    detections: List[Detection]

# --------- API ---------

@router.post("/detect", response_model=DetectResponse)
async def detect_bones(file: UploadFile = File(...)):
    """
    S1：上傳 X 光 + YOLO 偵測。
    TODO: 這裡接 YOLO + 寫入 vision.ImageCase / ImageDetection。
    目前先回傳假資料讓前端可以串。
    """
    # TODO: 你之後會在這裡：
    # 1) 建一筆 ImageCase
    # 2) 跑 YOLO
    # 3) 每個框寫 ImageDetection
    # 4) 回傳實際的 imageCaseId + detections

    dummy = DetectResponse(
        imageCaseId=123,
        detections=[
            Detection(
                detectionId=1001,
                boneId=10,
                smallBoneId=201,
                boneZh="鎖骨（左）",
                boneEn="Clavicle (L)",
                bbox=BBox(x=0.2, y=0.3, w=0.15, h=0.08),
                confidence=0.87,
            )
        ],
    )
    return dummy
