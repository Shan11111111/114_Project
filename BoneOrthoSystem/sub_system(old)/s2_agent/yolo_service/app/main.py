from fastapi import FastAPI, UploadFile, File
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import uuid

from .models import YoloResponse, YoloDetection


BASE_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = BASE_DIR / "data" / "outputs"
OUT_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="YOLO Service (stub)")

# 將輸出圖片掛在 /outputs 路徑
app.mount("/outputs", StaticFiles(directory=OUT_DIR), name="outputs")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/yolo/analyze", response_model=YoloResponse)
async def analyze(file: UploadFile = File(...)):
    """
    目前是 stub 版本：
    - 儲存圖片
    - 回傳假裝的骨頭辨識結果
    未來你可以把 YOLO 模型推論塞進來。
    """
    # 儲存圖片
    ext = (file.filename or "").split(".")[-1].lower()
    fname = f"{uuid.uuid4().hex}.{ext}"
    fpath = OUT_DIR / fname

    data = await file.read()
    with open(fpath, "wb") as f:
        f.write(data)

    boxed_url = f"/outputs/{fname}"

    # 假偵測結果
    dets = [
        YoloDetection(bone="Femur_L", confidence=0.92),
        YoloDetection(bone="Tibia_L", confidence=0.88),
    ]

    return YoloResponse(
        boxed_url=boxed_url,
        detections=dets,
    )
