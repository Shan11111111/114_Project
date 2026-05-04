from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import JSONResponse, FileResponse
from typing import Optional
from pathlib import Path
import pyodbc
import traceback

router = APIRouter(prefix="/history", tags=["s1_history"])


def get_db_conn():
    return pyodbc.connect(
        "DRIVER={ODBC Driver 17 for SQL Server};"
        "SERVER=localhost;"
        "DATABASE=BoneDB;"
        "Trusted_Connection=yes;"
    )


def find_project_root(start: Path, target_name: str = "BoneOrthoSystem") -> Path:
    current = start.resolve()
    for parent in [current] + list(current.parents):
        if parent.name == target_name:
            return parent
    return start.resolve()


def resolve_user_id(cursor, raw_user_id: str) -> Optional[int]:
    if raw_user_id is None:
        return None

    raw_user_id = str(raw_user_id).strip()
    if not raw_user_id:
        return None

    # 前端如果已經傳數字 users.id，直接用
    try:
        num = int(raw_user_id)
        if num > 0:
            return num
    except ValueError:
        pass

    # 相容舊資料：如果前端傳 username / 舊 user_id / email，就去 users 表解析成真正的 users.id
    cursor.execute("""
        SELECT TOP 1
            id,
            user_id,
            username,
            email
        FROM dbo.users
        WHERE username = ?
           OR CAST(user_id AS NVARCHAR(255)) = ?
           OR email = ?
        ORDER BY id
    """, raw_user_id, raw_user_id, raw_user_id)

    row = cursor.fetchone()
    if not row:
        return None

    # 最終一律回傳 users.id
    try:
        num = int(row.id)
        if num > 0:
            return num
    except (TypeError, ValueError):
        pass

    return None


@router.get("")
def get_history(user_id: str = Query(...)):
    conn = None
    try:
        conn = get_db_conn()
        cursor = conn.cursor()

        resolved_user_id = resolve_user_id(cursor, user_id)
        if resolved_user_id is None:
            return {"items": []}

        cursor.execute("""
            SELECT
                ic.ImageCaseId,
                ic.CreatedByUserId,
                ic.BoneImageId,
                ic.Source,
                ic.CreatedAt,
                bi.image_name,
                bi.image_path,
                bi.content_type,
                COUNT(d.DetectionId) AS detection_count
            FROM vision.ImageCase ic
            LEFT JOIN dbo.Bone_Images bi
                ON ic.BoneImageId = bi.image_id
            LEFT JOIN vision.ImageDetection d
                ON ic.ImageCaseId = d.ImageCaseId
            WHERE ic.CreatedByUserId = ?
            GROUP BY
                ic.ImageCaseId,
                ic.CreatedByUserId,
                ic.BoneImageId,
                ic.Source,
                ic.CreatedAt,
                bi.image_name,
                bi.image_path,
                bi.content_type
            ORDER BY ic.CreatedAt DESC
        """, resolved_user_id)

        rows = cursor.fetchall()

        items = []
        for row in rows:
            items.append({
                "image_case_id": row.ImageCaseId,
                "user_id": row.CreatedByUserId,  # 前端欄位名先維持不變
                "bone_image_id": row.BoneImageId,
                "source": row.Source,
                "created_at": row.CreatedAt.isoformat() if row.CreatedAt else None,
                "image_name": row.image_name,
                "image_path": row.image_path,
                "content_type": row.content_type,
                "detection_count": int(row.detection_count or 0),
            })

        return {"items": items}

    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={
                "detail": "get history failed",
                "error": repr(e),
            },
        )
    finally:
        if conn is not None:
            conn.close()


@router.get("/{case_id}")
def get_history_detail(case_id: int):
    conn = None
    try:
        conn = get_db_conn()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                ic.ImageCaseId,
                ic.CreatedByUserId,
                ic.BoneImageId,
                ic.Source,
                ic.CreatedAt,
                bi.image_name,
                bi.image_path,
                bi.content_type
            FROM vision.ImageCase ic
            LEFT JOIN dbo.Bone_Images bi
                ON ic.BoneImageId = bi.image_id
            WHERE ic.ImageCaseId = ?
        """, case_id)

        case_row = cursor.fetchone()
        if not case_row:
            raise HTTPException(status_code=404, detail="找不到該歷史紀錄")

        cursor.execute("""
            SELECT
                d.DetectionId,
                d.ImageCaseId,
                d.BoneId,
                d.SmallBoneId,
                d.Label41,
                d.Confidence,
                d.X1,
                d.Y1,
                d.X2,
                d.Y2,
                d.CreatedAt,
                d.PolyJson,
                d.P1X,
                d.P1Y,
                d.P2X,
                d.P2Y,
                d.P3X,
                d.P3Y,
                d.P4X,
                d.P4Y,
                d.PolyIsNormalized,
                d.Cx,
                d.Cy,
                d.CreatedByUserId,
                b.bone_id AS bone_info_id,
                b.bone_en,
                b.bone_zh,
                b.bone_region,
                b.bone_desc
            FROM vision.ImageDetection d
            LEFT JOIN dbo.Bone_Info b
                ON d.BoneId = b.bone_id
            WHERE d.ImageCaseId = ?
            ORDER BY d.DetectionId ASC
        """, case_id)

        detections = []
        for d in cursor.fetchall():
            detections.append({
                "detection_id": d.DetectionId,
                "image_case_id": d.ImageCaseId,
                "bone_id": d.BoneId,
                "small_bone_id": d.SmallBoneId,
                "label41": d.Label41,
                "confidence": float(d.Confidence) if d.Confidence is not None else None,
                "x1": d.X1,
                "y1": d.Y1,
                "x2": d.X2,
                "y2": d.Y2,
                "created_at": d.CreatedAt.isoformat() if d.CreatedAt else None,
                "poly_json": d.PolyJson,
                "p1x": d.P1X,
                "p1y": d.P1Y,
                "p2x": d.P2X,
                "p2y": d.P2Y,
                "p3x": d.P3X,
                "p3y": d.P3Y,
                "p4x": d.P4X,
                "p4y": d.P4Y,
                "poly_is_normalized": d.PolyIsNormalized,
                "cx": d.Cx,
                "cy": d.Cy,
                "created_by_user_id": d.CreatedByUserId,
                "bone_info": {
                    "bone_id": d.bone_info_id,
                    "bone_en": d.bone_en,
                    "bone_zh": d.bone_zh,
                    "bone_region": d.bone_region,
                    "bone_desc": d.bone_desc,
                } if d.bone_info_id is not None else None,
            })

        return {
            "image_case_id": case_row.ImageCaseId,
            "user_id": case_row.CreatedByUserId,  # 前端欄位名先維持不變
            "bone_image_id": case_row.BoneImageId,
            "source": case_row.Source,
            "created_at": case_row.CreatedAt.isoformat() if case_row.CreatedAt else None,
            "image_name": case_row.image_name,
            "image_path": case_row.image_path,
            "content_type": case_row.content_type,
            "detection_count": len(detections),
            "detections": detections,
        }

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={
                "detail": "get history detail failed",
                "error": repr(e),
            },
        )
    finally:
        if conn is not None:
            conn.close()

@router.delete("/{case_id}")
def delete_history(case_id: int, user_id: str = Query(...)):
    conn = None
    try:
        conn = get_db_conn()
        cursor = conn.cursor()

        resolved_user_id = resolve_user_id(cursor, user_id)
        if resolved_user_id is None:
            raise HTTPException(status_code=401, detail="使用者不存在或未登入")

        # 先確認這筆紀錄屬於目前使用者
        cursor.execute("""
            SELECT ImageCaseId
            FROM vision.ImageCase
            WHERE ImageCaseId = ?
              AND CreatedByUserId = ?
        """, case_id, resolved_user_id)

        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="找不到紀錄或無權限刪除")

        # 先刪這筆 case 底下的 detections
        cursor.execute("""
            DELETE FROM vision.ImageDetection
            WHERE ImageCaseId = ?
        """, case_id)

        # 再刪這一筆 ImageCase
        cursor.execute("""
            DELETE FROM vision.ImageCase
            WHERE ImageCaseId = ?
              AND CreatedByUserId = ?
        """, case_id, resolved_user_id)

        conn.commit()

        return {
            "ok": True,
            "deleted_case_id": case_id,
        }

    except HTTPException:
        raise
    except Exception as e:
        if conn is not None:
            conn.rollback()
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={
                "detail": "delete history failed",
                "error": repr(e),
            },
        )
    finally:
        if conn is not None:
            conn.close()

@router.get("/image/{bone_image_id}")
def preview_history_image(bone_image_id: int):
    conn = None
    try:
        conn = get_db_conn()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                image_id,
                image_name,
                image_path,
                content_type
            FROM dbo.Bone_Images
            WHERE image_id = ?
        """, bone_image_id)

        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="找不到圖片資料")

        if not row.image_path:
            raise HTTPException(status_code=404, detail="image_path 為空")

        project_root = find_project_root(Path(__file__).resolve())
        file_path = (project_root / row.image_path.lstrip("/\\")).resolve()

        if not file_path.exists():
            raise HTTPException(status_code=404, detail=f"圖片檔不存在: {file_path}")

        return FileResponse(
            path=str(file_path),
            media_type=row.content_type or "application/octet-stream",
            filename=row.image_name or f"{bone_image_id}.png",
        )

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={
                "detail": "get history image failed",
                "error": repr(e),
            },
        )
    finally:
        if conn is not None:
            conn.close()