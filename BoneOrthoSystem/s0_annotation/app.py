from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from s0_annotation import router as s0_router
from s1_detection.router import router as s1_router
#from s2_agent.router import router as s2_router
from s3_viewer.router import router as s3_router
from shared.router import router as shared_router

app = FastAPI(
    title="BoneOrtho Backend",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")  # ★ 新增這個
def root():
    return {"status": "ok", "message": "BoneOrtho Backend running", "modules": ["s0", "s1", "s2", "s3"]}

app.include_router(shared_router, prefix="/shared")
app.include_router(s0_router)
app.include_router(s1_router)
#app.include_router(s2_router)
app.include_router(s3_router)
