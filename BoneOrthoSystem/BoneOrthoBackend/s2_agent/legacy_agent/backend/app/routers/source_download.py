# routers/source_download.py
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pathlib import Path

router = APIRouter(prefix="/s2x/sources", tags=["S2 Sources"])

BACKEND_ROOT = Path(__file__).resolve()
for _ in range(30):
    if (BACKEND_ROOT / "db.py").exists():
        break
    BACKEND_ROOT = BACKEND_ROOT.parent

DOCS_DIR = (BACKEND_ROOT / "public" / "edu_docs").resolve()

@router.get("/download")
def download(file: str = Query(...)):
    p = (DOCS_DIR / file).resolve()
    if not str(p).startswith(str(DOCS_DIR)):
        raise HTTPException(400, "Invalid path")
    if not p.exists():
        raise HTTPException(404, "Not found")
    return FileResponse(p, filename=p.name)
