from pydantic import BaseModel
from typing import List

class YoloDetection(BaseModel):
    bone: str
    confidence: float

class YoloResponse(BaseModel):
    boxed_url: str
    detections: List[YoloDetection]
