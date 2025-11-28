from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional
from pathlib import Path
from datetime import datetime
import sys
import uuid
import shutil

# ========= 讓後端可以 import 專案根目錄的 db.py =========
BACKEND_DIR = Path(__file__).resolve().parent
S0_DIR = BACKEND_DIR.parent
BASE_DIR = S0_DIR.parent  # C:\BoneOrthoSystem
if str(BASE_DIR) not in sys.path:
    sys.path.append(str(BASE_DIR))

from db import get_connection  # 共用 DB 連線
# =====================================================

app = FastAPI(title="S0 Annotation API")

# ========= 靜態檔設定 (圖片) =========
STATIC_DIR = BACKEND_DIR / "static"
IMAGE_DIR = STATIC_DIR / "images"
STATIC_DIR.mkdir(exist_ok=True)
IMAGE_DIR.mkdir(parents=True, exist_ok=True)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# ========= CORS =========
origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    # 共用主機 IP，例如：
    # "http://10.20.30.40:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_conn():
    # 統一用這個，就會走 C:\BoneOrthoSystem\db.py 的設定
    return get_connection()


# ========= Pydantic models =========

class DetectionBox(BaseModel):
    detection_id: int
    bone_id: Optional[int] = None
    small_bone_id: Optional[int] = None
    x_min: float
    y_min: float
    x_max: float
    y_max: float
    score: Optional[float] = None


class AnnotationBoxOut(BaseModel):
    annotation_id: int
    source: str
    bone_id: Optional[int] = None
    small_bone_id: Optional[int] = None
    x_min: float
    y_min: float
    x_max: float
    y_max: float
    created_by: Optional[str] = None
    created_at: str


class AnnotationBoxIn(BaseModel):
    source: str  # "human_gt"
    bone_id: Optional[int] = None
    small_bone_id: Optional[int] = None
    x_min: float
    y_min: float
    x_max: float
    y_max: float
    created_by: Optional[str] = None


class ImageCaseSummary(BaseModel):
    image_case_id: int
    source: str
    created_at: str
    has_annotations: bool


class ImageDetailResponse(BaseModel):
    image_case_id: int
    image_url: Optional[str] = None
    detections: List[DetectionBox]
    annotations: List[AnnotationBoxOut]


class BoneOption(BaseModel):
    bone_id: int
    bone_zh: str
    bone_en: str


class SmallBoneOption(BaseModel):
    small_bone_id: int
    bone_id: int
    bone_zh: str
    bone_en: str
    small_bone_zh: str
    small_bone_en: str


class BoneOptionsResponse(BaseModel):
    bones: List[BoneOption]
    small_bones: List[SmallBoneOption]


# ========= API 1：列出 ImageCase =========

@app.get("/annotation/images", response_model=List[ImageCaseSummary])
def list_image_cases():
    """
    列出所有 ImageCase，標記有沒有人工標註（human_gt）。
    """
    conn = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT 
                ic.ImageCaseId,
                ic.Source,
                ic.CreatedAt,
                CASE WHEN EXISTS (
                    SELECT 1 
                    FROM vision.ImageAnnotation a
                    WHERE a.ImageCaseId = ic.ImageCaseId
                      AND a.Source = 'human_gt'
                ) THEN 1 ELSE 0 END AS HasAnnotations
            FROM vision.ImageCase AS ic
            ORDER BY ic.CreatedAt DESC
            """
        )
        rows = cur.fetchall()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error in list_image_cases: {e}")
    finally:
        if conn:
            conn.close()

    result: List[ImageCaseSummary] = []
    for r in rows:
        result.append(
            ImageCaseSummary(
                image_case_id=r.ImageCaseId,
                source=r.Source,
                created_at=r.CreatedAt.isoformat(),
                has_annotations=bool(r.HasAnnotations),
            )
        )
    return result


# ========= API 2：取得單一 ImageCase 詳細資料 =========

@app.get("/annotation/image/{image_case_id}", response_model=ImageDetailResponse)
def get_image_detail(image_case_id: int):
    """
    回傳：
      - image_url（從 Bone_Images.image_path）
      - YOLO 偵測框（vision.ImageDetection）
      - 人工標註（vision.ImageAnnotation）
    """
    conn = None
    try:
        conn = get_conn()
        cur = conn.cursor()

        # 1) ImageCase + Bone_Images
        cur.execute(
            """
            SELECT 
                ic.ImageCaseId,
                ic.BoneImageId,
                ic.Source,
                ic.CreatedAt,
                bi.image_path
            FROM vision.ImageCase AS ic
            LEFT JOIN dbo.Bone_Images AS bi
                ON ic.BoneImageId = bi.image_id
            WHERE ic.ImageCaseId = ?
            """,
            image_case_id,
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="ImageCase not found")

        image_url = row.image_path if row.image_path else None

        # 2) YOLO 偵測框
        cur.execute(
            """
            SELECT 
                d.DetectionId,
                d.BoneId,
                d.SmallBoneId,
                d.X1 AS XMin,
                d.Y1 AS YMin,
                d.X2 AS XMax,
                d.Y2 AS YMax,
                d.Confidence AS Score
            FROM vision.ImageDetection AS d
            WHERE d.ImageCaseId = ?
            """,
            image_case_id,
        )
        det_rows = cur.fetchall()

        detections: List[DetectionBox] = []
        for r in det_rows:
            detections.append(
                DetectionBox(
                    detection_id=r.DetectionId,
                    bone_id=r.BoneId,
                    small_bone_id=r.SmallBoneId,
                    x_min=r.XMin,
                    y_min=r.YMin,
                    x_max=r.XMax,
                    y_max=r.YMax,
                    score=r.Score,
                )
            )

        # 3) 人工標註
        cur.execute(
            """
            SELECT 
                a.AnnotationId,
                a.Source,
                a.BoneId,
                a.SmallBoneId,
                a.XMin,
                a.YMin,
                a.XMax,
                a.YMax,
                a.CreatedBy,
                a.CreatedAt
            FROM vision.ImageAnnotation AS a
            WHERE a.ImageCaseId = ?
            ORDER BY a.CreatedAt
            """,
            image_case_id,
        )
        ann_rows = cur.fetchall()

        annotations: List[AnnotationBoxOut] = []
        for a in ann_rows:
            annotations.append(
                AnnotationBoxOut(
                    annotation_id=a.AnnotationId,
                    source=a.Source,
                    bone_id=a.BoneId,
                    small_bone_id=a.SmallBoneId,
                    x_min=a.XMin,
                    y_min=a.YMin,
                    x_max=a.XMax,
                    y_max=a.YMax,
                    created_by=a.CreatedBy,
                    created_at=a.CreatedAt.isoformat(),
                )
            )

        return ImageDetailResponse(
            image_case_id=image_case_id,
            image_url=image_url,
            detections=detections,
            annotations=annotations,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error in get_image_detail: {e}")
    finally:
        if conn:
            conn.close()


# ========= API 3：儲存人工標註 =========

@app.post("/annotation/image/{image_case_id}/annotations")
def save_annotations(image_case_id: int, boxes: List[AnnotationBoxIn]):
    """
    把這張圖的 human_gt 標註全部重寫：
      先 DELETE，再 INSERT 全部 boxes。
    """
    if not boxes:
        return {"ok": True, "message": "no boxes"}

    conn = None
    try:
        conn = get_conn()
        cur = conn.cursor()

        # 先刪掉原本這張圖的 human_gt
        cur.execute(
            """
            DELETE FROM vision.ImageAnnotation
            WHERE ImageCaseId = ? AND Source = 'human_gt'
            """,
            image_case_id,
        )

        # 再全部插入
        for b in boxes:
            cur.execute(
                """
                INSERT INTO vision.ImageAnnotation (
                    ImageCaseId, Source,
                    BoneId, SmallBoneId,
                    XMin, YMin, XMax, YMax,
                    CreatedBy, CreatedAt
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                image_case_id,
                b.source,
                b.bone_id,
                b.small_bone_id,
                b.x_min,
                b.y_min,
                b.x_max,
                b.y_max,
                b.created_by or "s0_annotation",
                datetime.utcnow(),
            )

        conn.commit()
        return {"ok": True, "count": len(boxes)}
    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=f"DB error in save_annotations: {e}")
    finally:
        if conn:
            conn.close()


# ========= API 4：上傳圖片 =========

@app.post("/annotation/upload")
async def upload_image(
    file: UploadFile = File(...),
    user_id: str = Form("demo_user"),
    source: str = Form("upload_web"),
):
    """
    上傳一張圖片：
      1. 存到 backend/static/images
      2. INSERT dbo.Bone_Images
      3. INSERT vision.ImageCase
    回傳 image_case_id + image_url
    """
    conn = None
    try:
        if not file.filename:
            raise HTTPException(status_code=400, detail="沒有收到檔案")

        ext = Path(file.filename).suffix.lower()
        if ext not in [".png", ".jpg", ".jpeg"]:
            raise HTTPException(status_code=400, detail="只接受 PNG / JPG / JPEG 圖片")

        new_name = f"{uuid.uuid4().hex}{ext}"
        dest_path = IMAGE_DIR / new_name

        with dest_path.open("wb") as f:
            shutil.copyfileobj(file.file, f)

        # 存在 DB 的路徑（相對路徑，前端會補 API_BASE）
        public_url = f"/static/images/{new_name}"

        conn = get_conn()
        cur = conn.cursor()

        # 1) Bone_Images
        cur.execute(
            """
            INSERT INTO dbo.Bone_Images
                (bone_id, image_name, image_path, content_type, created_at)
            OUTPUT INSERTED.image_id
            VALUES (?, ?, ?, ?, SYSDATETIME());
            """,
            None,               # bone_id 先空著
            file.filename,
            public_url,
            file.content_type,
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=500, detail="無法取得新增的 image_id")
        bone_image_id = row[0]

        # 2) ImageCase
        cur.execute(
            """
            INSERT INTO vision.ImageCase
                (UserId, BoneImageId, Source, CreatedAt)
            OUTPUT INSERTED.ImageCaseId, INSERTED.CreatedAt
            VALUES (?, ?, ?, SYSDATETIME());
            """,
            user_id,
            bone_image_id,
            source,
        )
        row2 = cur.fetchone()
        if not row2:
            raise HTTPException(status_code=500, detail="無法取得新增的 ImageCaseId")
        image_case_id, created_at = row2

        conn.commit()

        return {
            "image_case_id": image_case_id,
            "image_url": public_url,
            "source": source,
            "created_at": created_at.isoformat(),
        }

    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        print("upload_image error:", repr(e))
        raise HTTPException(status_code=500, detail=f"upload_image error: {e}")
    finally:
        if conn:
            conn.close()


# ========= API 5：骨頭名稱選單 (Bone + SmallBone) =========

@app.get("/annotation/bones", response_model=BoneOptionsResponse)
def get_bone_options():
    """
    提供前端右側下拉選單用：
      - bones: 大類骨 (Bone_Info)
      - small_bones: 細項骨 ([dbo].[bone.Bone_small])
    """
    conn = None
    try:
        conn = get_conn()
        cur = conn.cursor()

        # 大類
        cur.execute(
            """
            SELECT bone_id, bone_zh, bone_en
            FROM dbo.Bone_Info
            ORDER BY bone_id
            """
        )
        bone_rows = cur.fetchall()

        # 細項
        cur.execute(
            """
            SELECT 
                s.small_bone_id,
                s.bone_id,
                b.bone_zh,
                b.bone_en,
                s.small_bone_zh,
                s.small_bone_en
            FROM [dbo].[bone.Bone_small] AS s
            INNER JOIN dbo.Bone_Info AS b
                ON s.bone_id = b.bone_id
            ORDER BY s.bone_id, s.small_bone_id
            """
        )
        small_rows = cur.fetchall()

        bones = [
            BoneOption(
                bone_id=r.bone_id,
                bone_zh=r.bone_zh,
                bone_en=r.bone_en,
            )
            for r in bone_rows
        ]
        small_bones = [
            SmallBoneOption(
                small_bone_id=r.small_bone_id,
                bone_id=r.bone_id,
                bone_zh=r.bone_zh,
                bone_en=r.bone_en,
                small_bone_zh=r.small_bone_zh,
                small_bone_en=r.small_bone_en,
            )
            for r in small_rows
        ]

        return BoneOptionsResponse(bones=bones, small_bones=small_bones)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error in get_bone_options: {e}")
    finally:
        if conn:
            conn.close()
