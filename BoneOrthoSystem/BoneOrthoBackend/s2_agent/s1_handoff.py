# s1_handoff.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from uuid import uuid4
import re
from collections import Counter

from db import get_connection

router = APIRouter(prefix="/s2/agent", tags=["S2 Handoff"])


class BackendMsg(BaseModel):
    role: str                 # "user" | "assistant"
    type: str                 # "text" | "image"
    content: Optional[str] = None
    url: Optional[str] = None
    filetype: Optional[str] = None


class BootstrapIn(BaseModel):
    image_case_id: int
    question: Optional[str] = None
    top_k: int = 10


class BootstrapOut(BaseModel):
    session_id: str
    image_case_id: int
    seed_messages: List[BackendMsg]
    detections: List[Dict[str, Any]]


# -------------------------
# Helpers
# -------------------------

_tail_num_re = re.compile(r"\s*\(\d+\)\s*$")


def _normalize_text(v: Any) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, bytes):
        v = v.decode("utf-8", "replace")
    if not isinstance(v, str):
        v = str(v)
    try:
        v = v.encode("utf-8", "surrogateescape").decode("utf-8", "replace")
    except Exception:
        v = v.encode("utf-8", "ignore").decode("utf-8", "ignore")
    return v


def _clean_zh_name(name: Optional[str]) -> Optional[str]:
    if not name:
        return None
    name = _normalize_text(name) or ""
    return _tail_num_re.sub("", name).strip() or None


def _display_name(bone_zh: Optional[str], bone_en: Optional[str]) -> Optional[str]:
    zh = _clean_zh_name(bone_zh)
    en = _normalize_text(bone_en)
    en = (en or "").strip() or None
    if zh and en:
        return f"{zh}（{en}）"
    return zh or en


def _build_seed_text(case_id: int, dets: List[Dict[str, Any]], user_question: str) -> str:
    counter = Counter()
    unknown_cnt = 0

    for d in dets:
        name = _display_name(d.get("bone_zh"), d.get("bone_en"))
        if name:
            counter[name] += 1
        else:
            unknown_cnt += 1

    lines: List[str] = []
    lines.append("偵測到的主要骨骼部位：")
    if counter:
        for name, cnt in counter.most_common():
            lines.append(f"- {name}" + (f" ×{cnt}" if cnt > 1 else ""))
    else:
        lines.append("- （目前沒有可對應到骨名的偵測結果）")

    if unknown_cnt > 0:
        lines.append(f"- 未能對應明確骨名的區域：{unknown_cnt} 個（可能是重疊/局部遮蔽/分類不確定）")

    constraints = (
        "回答限制（請遵守）：\n"
        "1) 請只圍繞本次偵測到的骨骼部位與這張影像的判讀重點。\n"
    )

    seed_text = (
        f"我從辨識頁面帶入一張骨科 X 光影像的偵測摘要。\n"
        f"ImageCaseId: {case_id}\n\n"
        + "\n".join(lines)
        + "\n\n我的問題：\n"
        + user_question.strip()
        + "\n\n"
        + constraints
    )
    return _normalize_text(seed_text) or seed_text


def _has_col(cur, schema: str, table: str, col: str) -> bool:
    cur.execute(
        """
        SELECT 1
        FROM sys.columns c
        JOIN sys.objects o ON c.object_id = o.object_id
        JOIN sys.schemas s ON o.schema_id = s.schema_id
        WHERE s.name = ? AND o.name = ? AND c.name = ?
        """,
        (schema, table, col),
    )
    return cur.fetchone() is not None


@router.post("/bootstrap-from-s1", response_model=BootstrapOut)
def bootstrap_from_s1(body: BootstrapIn):
    case_id = body.image_case_id

    conn = get_connection()
    try:
        cur = conn.cursor()

        # 1) 取圖片路徑
        cur.execute(
            """
            SELECT TOP 1
                ic.ImageCaseId,
                bi.image_path,
                bi.content_type
            FROM vision.ImageCase ic
            JOIN dbo.Bone_Images bi ON ic.BoneImageId = bi.image_id
            WHERE ic.ImageCaseId = ?
            """,
            (case_id,),
        )
        r = cur.fetchone()
        if not r:
            raise HTTPException(404, f"找不到 ImageCaseId={case_id}")

        image_url = _normalize_text(getattr(r, "image_path", None) or "")
        image_url = (image_url or "").strip()
        filetype = _normalize_text(getattr(r, "content_type", None) or "") or None
        if filetype:
            filetype = filetype.strip() or None

        if not image_url:
            raise HTTPException(400, "image_path 是空的，S1 可能沒寫成功")

        # ✅ 2) 偵測欄位存在檢查（避免你某台 DB 還沒 migrate 就爆掉）
        has_polyjson = _has_col(cur, "vision", "ImageDetection", "PolyJson")
        has_poly_norm = _has_col(cur, "vision", "ImageDetection", "PolyIsNormalized")

        # （P1~P4 可選；有 PolyJson 其實就夠畫旋轉框）
        p_cols = ["P1X","P1Y","P2X","P2Y","P3X","P3Y","P4X","P4Y"]
        has_p = {c: _has_col(cur, "vision", "ImageDetection", c) for c in p_cols}

        extra_select = []
        if has_polyjson:
            extra_select.append("d.PolyJson")
        if has_poly_norm:
            extra_select.append("d.PolyIsNormalized")
        for c in p_cols:
            if has_p[c]:
                extra_select.append(f"d.{c}")

        extra_sql = (",\n                " + ",\n                ".join(extra_select)) if extra_select else ""

        # 3) 取 detections（bbox + 可選 poly）
        cur.execute(
            f"""
            SELECT TOP ({int(body.top_k)})
                d.BoneId,
                b.bone_zh,
                b.bone_en,
                d.Label41,
                d.Confidence,
                d.X1, d.Y1, d.X2, d.Y2
                {extra_sql}
            FROM vision.ImageDetection d
            LEFT JOIN dbo.Bone_Info b ON d.BoneId = b.bone_id
            WHERE d.ImageCaseId = ?
            ORDER BY d.Confidence DESC
            """,
            (case_id,),
        )

        dets: List[Dict[str, Any]] = []
        for row in cur.fetchall():
            bone_id = getattr(row, "BoneId", None)
            bone_zh = _normalize_text(getattr(row, "bone_zh", None))
            bone_en = _normalize_text(getattr(row, "bone_en", None))
            label41 = _normalize_text(getattr(row, "Label41", None))
            conf = float(getattr(row, "Confidence", 0.0) or 0.0)

            x1 = float(getattr(row, "X1", 0.0)) if getattr(row, "X1", None) is not None else None
            y1 = float(getattr(row, "Y1", 0.0)) if getattr(row, "Y1", None) is not None else None
            x2 = float(getattr(row, "X2", 0.0)) if getattr(row, "X2", None) is not None else None
            y2 = float(getattr(row, "Y2", 0.0)) if getattr(row, "Y2", None) is not None else None

            det = {
                "bone_id": bone_id,
                "bone_zh": bone_zh,
                "bone_en": bone_en,
                "label41": label41,
                "confidence": conf,
                "bbox": [x1, y1, x2, y2],
            }

            # ✅ 把旋轉框資訊一起回傳（前端就能畫 polygon）
            if has_polyjson:
                det["PolyJson"] = _normalize_text(getattr(row, "PolyJson", None))
                # 也順手給一個 alias，避免前端有人叫 poly_json
                det["poly_json"] = det["PolyJson"]

            if has_poly_norm:
                det["PolyIsNormalized"] = getattr(row, "PolyIsNormalized", None)

            # P1~P4（有就回，沒就算了）
            for c in p_cols:
                if has_p[c]:
                    det[c] = getattr(row, c, None)

            dets.append(det)

        # 4) 問題（預設）
        question = (body.question or "").strip()
        if not question:
            question = (
                "請用衛教方式解釋偵測到的骨骼部位（位置、功能），"
                "並從 X 光判讀角度說明常見需要留意的重點（例如骨折、脫臼、關節間隙變化等），"
                "最後給我 3 個延伸提問。"
            )

        session_id = f"s1-{case_id}-{uuid4().hex[:8]}"

        # 5) seed_text（人類可讀摘要，不塞 bbox/conf）
        seed_text = _build_seed_text(case_id, dets, question)

        seed_messages = [
            BackendMsg(role="user", type="image", url=image_url, filetype=filetype),
            BackendMsg(role="user", type="text", content=seed_text),
        ]

        return BootstrapOut(
            session_id=session_id,
            image_case_id=case_id,
            seed_messages=seed_messages,
            detections=dets,
        )

    finally:
        conn.close()
