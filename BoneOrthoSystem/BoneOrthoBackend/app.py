from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from s0_annotation.router import router as s0_router
from s1_detection.router import router as s1_router
from s2_agent.router import router as s2_router
from s3_viewer.router import router as s3_router

app = FastAPI(title="BoneOrtho Backend")

# 先全部開放，之後再鎖指定前端網域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 四個子系統掛進來
app.include_router(s0_router, prefix="/api/s0", tags=["S0 Annotation"])
app.include_router(s1_router, prefix="/api/s1", tags=["S1 Detection"])
app.include_router(s2_router, prefix="/api/s2", tags=["S2 Agent"])
app.include_router(s3_router, prefix="/api/s3", tags=["S3 Viewer"])

@app.get("/health")
def health_check():
    return {"status": "ok"}
