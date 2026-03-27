from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import JSONResponse
from typing import Optional
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


def resolve_user_id(cursor, raw_user_id: str) -> Optional[int]:
    if raw_user_id is None:
        return None

    raw_user_id = str(raw_user_id).strip()
    if not raw_user_id:
        return None

    # 只有不是純數字時，才來 users 表找
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

    # 優先拿可轉 int 的 user_id，否則退回 id
    for value in [row.user_id, row.id]:
        try:
            num = int(value)
            if num > 0:
                return num
        except (TypeError, ValueError):
            continue

    return None


from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import JSONResponse
from typing import Optional
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


def resolve_user_id(cursor, raw_user_id: str) -> Optional[int]:
    if raw_user_id is None:
        return None

    raw_user_id = str(raw_user_id).strip()
    if not raw_user_id:
        return None

    # 如果本來就是數字
    try:
        num = int(raw_user_id)
        if num > 0:
            return num
    except ValueError:
        pass

    # 否則從 users 表找真正的數字 id
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

    for value in [row.user_id, row.id]:
        try:
            num = int(value)
            if num > 0:
                return num
        except (TypeError, ValueError):
            continue

    return None


@router.get("")
def get_history(user_id: str = Query(...)):
    conn = None
    try:
        conn = get_db_conn()
        cursor = conn.cursor()

        # 先解析成真正的數字 user id
        resolved_user_id = resolve_user_id(cursor, user_id)
        if resolved_user_id is None:
            return {"items": []}

        # ⚠️ 這裡改成字串比對，避免 ic.UserId 裡舊資料是 demo_user 時炸掉
        resolved_user_id_str = str(resolved_user_id)

        cursor.execute("""
            SELECT
                ic.ImageCaseId,
                ic.UserId,
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
            WHERE CAST(ic.UserId AS NVARCHAR(255)) = ?
            GROUP BY
                ic.ImageCaseId,
                ic.UserId,
                ic.BoneImageId,
                ic.Source,
                ic.CreatedAt,
                bi.image_name,
                bi.image_path,
                bi.content_type
            ORDER BY ic.CreatedAt DESC
        """, resolved_user_id_str)

        rows = cursor.fetchall()

        items = []
        for row in rows:
            items.append({
                "image_case_id": row.ImageCaseId,
                "user_id": row.UserId,
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
                ic.UserId,
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
                DetectionId,
                ImageCaseId,
                BoneId,
                SmallBoneId,
                Label41,
                Attr206,
                Side,
                Finger,
                Phalanx,
                SerialNumber,
                Confidence,
                X1,
                Y1,
                X2,
                Y2,
                CreatedAt,
                PolyJson,
                P1X,
                P1Y,
                P2X,
                P2Y,
                P3X,
                P3Y,
                P4X,
                P4Y,
                PolyIsNormalized,
                Cx,
                Cy,
                CreatedByUserId
            FROM vision.ImageDetection
            WHERE ImageCaseId = ?
            ORDER BY DetectionId ASC
        """, case_id)

        detections = []
        for d in cursor.fetchall():
            detections.append({
                "detection_id": d.DetectionId,
                "image_case_id": d.ImageCaseId,
                "bone_id": d.BoneId,
                "small_bone_id": d.SmallBoneId,
                "label41": d.Label41,
                "attr206": d.Attr206,
                "side": d.Side,
                "finger": d.Finger,
                "phalanx": d.Phalanx,
                "serial_number": d.SerialNumber,
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
            })

        return {
            "image_case_id": case_row.ImageCaseId,
            "user_id": case_row.UserId,
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