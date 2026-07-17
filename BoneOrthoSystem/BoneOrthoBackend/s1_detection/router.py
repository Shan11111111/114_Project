# router.py - 定義 S1 椎體檢測相關的 API 路由和處理邏輯
#s1_detection/router.py 
import traceback
import io
from pathlib import Path
from typing import Dict, Any, List, Optional

import pyodbc
from fastapi import (
    APIRouter,
    UploadFile,
    File,
    HTTPException,
    Depends,
    Query,
)
from fastapi.responses import JSONResponse, FileResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from ultralytics import YOLO
from PIL import Image

from auth.security import decode_access_token
from auth import repo as auth_repo

from .bone_service import (
    get_bone_info,
    get_mr_bone_group_by_bone_id,
    find_recommended_small_bone_id,
    assign_spine_levels,
)
from .image_service import save_case_and_detections
from .history_router import router as history_router
from .image_preview_router import router as image_preview_router
from .quiz_router import router as quiz_router

router = APIRouter(
    tags=["s1_detection"]
)

bearer_scheme = HTTPBearer(auto_error=False)

# 把獨立的 router 掛進 s1 router
router.include_router(history_router)
router.include_router(image_preview_router)
router.include_router(quiz_router)

# 用相對於本檔案的位置找 best.pt
BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "model" / "best.pt"

# BoneOrthoBackend 根目錄
PROJECT_ROOT = BASE_DIR.parent

# 範例影像 image_id 範圍
SAMPLE_ID_START = 3741
SAMPLE_ID_END = 4013

_model = None  # 懶載入用


def get_current_user_int_id(
    creds: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> int:
    if not creds or creds.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="缺少 Bearer token")

    data = decode_access_token(creds.credentials)
    if not data:
        raise HTTPException(status_code=401, detail="access_token 無效")

    sub = data.get("sub")
    user = None

    # 1) 先吃新版 token：sub = users.id(int)
    if sub is not None:
        sub_str = str(sub)
        if sub_str.isdigit():
            user = auth_repo.get_user_by_int_id(int(sub_str))
        else:
            # 2) 相容舊 token：sub 可能還是 uuid/user_id
            user = auth_repo.get_user_by_id(sub_str)

    # 3) 再保險：token 額外帶 user_id 時補救
    if not user and data.get("user_id"):
        user = auth_repo.get_user_by_id(str(data["user_id"]))

    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在")

    return int(user["id"])


def get_optional_current_user_int_id(
    creds: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> Optional[int]:
    if not creds or creds.scheme.lower() != "bearer":
        return None

    data = decode_access_token(creds.credentials)
    if not data:
        return None

    sub = data.get("sub")
    user = None

    if sub is not None:
        sub_str = str(sub)
        if sub_str.isdigit():
            user = auth_repo.get_user_by_int_id(int(sub_str))
        else:
            user = auth_repo.get_user_by_id(sub_str)

    if not user and data.get("user_id"):
        user = auth_repo.get_user_by_id(str(data["user_id"]))

    if not user:
        return None

    return int(user["id"])



def get_model():
    global _model
    if _model is None:
        if not MODEL_PATH.exists():
            raise HTTPException(
                status_code=503,
                detail=f"YOLO model not found: {MODEL_PATH}"
            )
        _model = YOLO(str(MODEL_PATH))
    return _model


def get_db_conn():
    return pyodbc.connect(
        "DRIVER={ODBC Driver 17 for SQL Server};"
        "SERVER=localhost;"
        "DATABASE=BoneDB;"
        "Trusted_Connection=yes;"
    )


def resolve_image_path(db_image_path: str) -> Path:
    """
    DB:
      /data/bone_examples/01_Cervical_Vertebrae_頸椎/0024037.png

    轉成:
      BoneOrthoBackend/data/bone_examples/01_Cervical_Vertebrae_頸椎/0024037.png
    """
    if not db_image_path:
        raise ValueError("image_path is empty")

    relative_path = db_image_path.replace("\\", "/").lstrip("/")
    return PROJECT_ROOT / relative_path


def get_image_row(image_id: int) -> Optional[Any]:
    conn = None
    try:
        conn = get_db_conn()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT
                bi.image_id,
                bi.bone_id,
                bi.image_name,
                bi.image_path,
                bi.content_type,
                b.bone_en,
                b.bone_zh,
                b.bone_region,
                b.bone_desc
            FROM dbo.Bone_Images AS bi
            LEFT JOIN dbo.Bone_Info AS b
                ON bi.bone_id = b.bone_id
            WHERE bi.image_id = ?
        """, image_id)
        row = cursor.fetchone()
        return row
    finally:
        if conn is not None:
            conn.close()


@router.get("/sample-images")
def list_sample_images():
    conn = None
    try:
        conn = get_db_conn()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                bi.image_id,
                bi.bone_id,
                bi.image_name,
                bi.image_path,
                bi.content_type,
                b.bone_en,
                b.bone_zh,
                b.bone_region,
                b.bone_desc
            FROM dbo.Bone_Images AS bi
            LEFT JOIN dbo.Bone_Info AS b
                ON bi.bone_id = b.bone_id
            WHERE bi.image_id BETWEEN ? AND ?
            ORDER BY bi.image_id
        """, SAMPLE_ID_START, SAMPLE_ID_END)

        rows = cursor.fetchall()

        items = []
        for row in rows:
            items.append({
                "id": row.image_id,
                "bone_id": row.bone_id,
                "bone_en": row.bone_en,
                "bone_zh": row.bone_zh,
                "bone_region": row.bone_region,
                "bone_desc": row.bone_desc,
                "name": row.image_name,
                "filename": row.image_name,
                "image_path": row.image_path,
                "content_type": row.content_type,
                "preview_url": f"/sample-images/{row.image_id}/preview",
                "download_url": f"/sample-images/{row.image_id}/download",
            })

        return {
            "count": len(items),
            "items": items,
        }

    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={
                "detail": "list sample images failed",
                "error": repr(e),
            },
        )
    finally:
        if conn is not None:
            conn.close()


@router.get("/sample-images/{image_id}/preview")
def preview_sample_image(image_id: int):
    try:
        row = get_image_row(image_id)

        if not row:
            raise HTTPException(status_code=404, detail="找不到 image_id")

        file_path = resolve_image_path(row.image_path)

        if not file_path.exists():
            raise HTTPException(
                status_code=404,
                detail=f"圖片檔不存在: {file_path}"
            )

        return FileResponse(
            path=str(file_path),
            media_type=row.content_type or "application/octet-stream",
            filename=row.image_name,
        )

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={
                "detail": "preview sample image failed",
                "error": repr(e),
            },
        )


@router.get("/sample-images/{image_id}/download")
def download_sample_image(image_id: int):
    try:
        row = get_image_row(image_id)

        if not row:
            raise HTTPException(status_code=404, detail="找不到 image_id")

        file_path = resolve_image_path(row.image_path)

        if not file_path.exists():
            raise HTTPException(
                status_code=404,
                detail=f"圖片檔不存在: {file_path}"
            )

        return FileResponse(
            path=str(file_path),
            media_type=row.content_type or "application/octet-stream",
            filename=row.image_name,
            headers={
                "Content-Disposition": f'attachment; filename="{row.image_name}"'
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={
                "detail": "download sample image failed",
                "error": repr(e),
            },
        )


@router.post("/predict")
async def predict(
    file: UploadFile = File(...),
    include_mr_data: bool = Query(
        default=False,
        description="是否附加 MR 細部骨骼、Mesh 與教學資料",
    ),
    created_by_user_id: Optional[int] = Depends(
        get_optional_current_user_int_id
    ),
):
    try:
        print(">>> /predict HIT")
        print(">>> filename =", file.filename)
        print(">>> content_type =", file.content_type)
        print(">>> created_by_user_id =", created_by_user_id, type(created_by_user_id))

        image_bytes = await file.read()
        print(">>> bytes =", len(image_bytes))

        pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        print(">>> PIL loaded")

        model = get_model()
        print(">>> model loaded")

        results = model.predict(
            pil_image,
            imgsz=1024,
            conf=0.5,
            iou=0.3,
            verbose=False,
        )
        print(">>> predict done")

        res = results[0]
        obb = getattr(res, "obb", None)

        if obb is None or len(obb) == 0:
            image_case_id = save_case_and_detections(
                image_bytes=image_bytes,
                original_filename=file.filename,
                content_type=file.content_type,
                boxes=[],
                created_by_user_id=created_by_user_id,
                source="api_upload",
            )

            response_data = {
                "image_case_id": image_case_id,
                "count": 0,
                "boxes": [],
            }

            if include_mr_data:
                response_data["bone_groups"] = []

            return response_data

        polys_flat = obb.xyxyxyxyn.tolist()
        confs = obb.conf.tolist()
        clses = obb.cls.tolist()

        boxes: List[Dict[str, Any]] = []
        names = model.names

        for i in range(len(confs)):
            flat_poly = polys_flat[i]
            cls_id = int(clses[i])

            if isinstance(names, dict):
                cls_name = names.get(cls_id, f"class_{cls_id}")
            else:
                cls_name = names[cls_id] if 0 <= cls_id < len(names) else f"class_{cls_id}"

            if isinstance(flat_poly[0], (list, tuple)):
                poly_pairs = [[float(x), float(y)] for x, y in flat_poly]
            else:
                poly_pairs = [
                    [float(flat_poly[j]), float(flat_poly[j + 1])]
                    for j in range(0, len(flat_poly), 2)
                ]

            bone_info = get_bone_info(cls_name)

            boxes.append({
                "poly": poly_pairs,
                "conf": round(float(confs[i]), 3),
                "cls_id": cls_id,
                "cls_name": cls_name,
                "bone_info": bone_info,
            })

        spine_map = assign_spine_levels(boxes)

        for idx, sub_label in spine_map.items():
            boxes[idx]["sub_label"] = sub_label
            boxes[idx]["sub_label_source"] = "vertical_order_inference"

        bone_groups: List[Dict[str, Any]] = []

        if include_mr_data:
            # 避免同一張影像內相同 bone_id 重複查詢 SQL
            group_cache: Dict[int, Optional[Dict[str, Any]]] = {}

            for box in boxes:
                bone_info = box.get("bone_info")
                if not bone_info:
                    box["recommended_small_bone_id"] = None
                    continue

                bone_id = bone_info.get("bone_id")
                if bone_id is None:
                    box["recommended_small_bone_id"] = None
                    continue

                bone_id = int(bone_id)

                if bone_id not in group_cache:
                    group_cache[bone_id] = get_mr_bone_group_by_bone_id(
                        bone_id
                    )

                mr_group = group_cache[bone_id]

                box["recommended_small_bone_id"] = (
                    find_recommended_small_bone_id(
                        mr_group=mr_group,
                        sub_label=box.get("sub_label"),
                    )
                )

            bone_groups = [
                group
                for group in group_cache.values()
                if group is not None
            ]
        
        image_case_id = save_case_and_detections(
            image_bytes=image_bytes,
            original_filename=file.filename,
            content_type=file.content_type,
            boxes=boxes,
            created_by_user_id=created_by_user_id,
            source="api_upload",
        )

        response_data = {
            "image_case_id": image_case_id,
            "count": len(boxes),
            "boxes": boxes,
        }

        if include_mr_data:
            response_data["bone_groups"] = bone_groups

        return response_data

    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={
                "detail": "predict failed",
                "error": repr(e),
            },
        )