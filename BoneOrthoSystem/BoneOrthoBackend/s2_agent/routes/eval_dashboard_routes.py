# eval_dashboard_routes.py
from fastapi import APIRouter, HTTPException
from db import get_connection
import requests
import xml.etree.ElementTree as ET
from datetime import datetime
import os
import json
import uuid

router = APIRouter(
    prefix="/eval-dashboard",
    tags=["eval-dashboard"]
)

@router.get("/knowledge-gaps")
def get_knowledge_gaps():
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT TOP 100
                GapId,
                Question,
                Claim,
                SuggestedQuery,
                SourceSuggestion,
                Status,
                CreatedAt
            FROM agent.RagKnowledgeGap
            ORDER BY GapId DESC
        """)
        rows = cur.fetchall()

    return [
        {
            "gap_id": r[0],
            "question": r[1],
            "claim": r[2],
            "suggested_query": r[3],
            "source_suggestion": r[4],
            "status": r[5],
            "created_at": str(r[6]),
        }
        for r in rows
    ]

@router.get("/summary")
def get_eval_summary():

    with get_connection() as conn:
        cur = conn.cursor()

        cur.execute("""
    SELECT TOP 100
        EvalId,
        Question,
        RagMode,
        Faithfulness,
        SupportedClaims,
        TotalClaims,
        CreatedAt,
        EvalJson
    FROM agent.RagEvalLog
    ORDER BY EvalId DESC
""")

        rows = cur.fetchall()

    result = []

    for r in rows:
        result.append({
    "eval_id": r[0],
    "question": r[1],
    "rag_mode": r[2],
    "faithfulness": r[3],
    "supported_claims": r[4],
    "total_claims": r[5],
    "created_at": str(r[6]),
    "eval_json": r[7],
})

    return result



@router.get("/gap-candidates/{gap_id}")
def get_gap_candidates(gap_id: int):

    with get_connection() as conn:
        cur = conn.cursor()

        cur.execute("""
        SELECT
            CandidateId,
            SourceType,
            Title,
            Url,
            Summary,
            Score
        FROM agent.RagKnowledgeGapCandidate
        WHERE GapId = ?
        ORDER BY Score DESC
        """, gap_id)

        rows = cur.fetchall()

    return [
        {
            "candidate_id": r[0],
            "source_type": r[1],
            "title": r[2],
            "url": r[3],
            "summary": r[4],
            "score": r[5],
        }
        for r in rows
    ]
    
def _get_gap_by_id(cur, gap_id: int):
    cur.execute("""
        SELECT
            GapId,
            Question,
            Claim,
            SuggestedQuery,
            SourceSuggestion,
            Status
        FROM agent.RagKnowledgeGap
        WHERE GapId = ?
    """, gap_id)

    row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="找不到這個知識缺口")

    return {
        "gap_id": row[0],
        "question": row[1],
        "claim": row[2],
        "suggested_query": row[3],
        "source_suggestion": row[4],
        "status": row[5],
    }


def _pubmed_search(query: str, limit: int = 5):
    """
    用 SuggestedQuery 去 PubMed 找候選資料。
    這裡先做輕量版：ESearch 找 PMID，再 EFetch 抓 title / abstract。
    """
    if not query:
        return []

    esearch_url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"

    esearch_params = {
        "db": "pubmed",
        "term": query,
        "retmode": "json",
        "retmax": limit,
    }

    try:
        esearch_resp = requests.get(esearch_url, params=esearch_params, timeout=10)
        esearch_resp.raise_for_status()
        ids = esearch_resp.json().get("esearchresult", {}).get("idlist", [])
    except Exception:
        return []

    if not ids:
        return []

    efetch_url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"

    efetch_params = {
        "db": "pubmed",
        "id": ",".join(ids),
        "retmode": "xml",
    }

    try:
        efetch_resp = requests.get(efetch_url, params=efetch_params, timeout=10)
        efetch_resp.raise_for_status()
        root = ET.fromstring(efetch_resp.text)
    except Exception:
        return []

    results = []

    for article in root.findall(".//PubmedArticle"):
        pmid_el = article.find(".//PMID")
        title_el = article.find(".//ArticleTitle")
        abstract_els = article.findall(".//AbstractText")

        pmid = pmid_el.text if pmid_el is not None else ""
        title = "".join(title_el.itertext()).strip() if title_el is not None else "Untitled PubMed Article"

        abstract_parts = []
        for a in abstract_els:
            text = "".join(a.itertext()).strip()
            if text:
                abstract_parts.append(text)

        abstract = "\n".join(abstract_parts).strip()

        if not abstract:
            abstract = "PubMed article found, but no abstract was available."

        results.append({
            "source_type": "pubmed",
            "title": title,
            "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else None,
            "summary": abstract[:1800],
            "score": 0.75,
        })

    return results


def _simple_claim_coverage_score(claim: str, text: str) -> float:
    """
    先用簡單關鍵字重疊做初版驗證。
    這不是最終版 LLM Judge，但至少可以避免完全無關資料被當成已補。
    """
    if not claim or not text:
        return 0.0

    claim_words = {
        w.lower()
        for w in claim.replace("，", " ").replace("。", " ").replace(",", " ").replace(".", " ").split()
        if len(w.strip()) >= 2
    }

    text_lower = text.lower()

    if not claim_words:
        return 0.0

    hit = sum(1 for w in claim_words if w in text_lower)
    score = hit / max(len(claim_words), 1)

    return round(min(score, 1.0), 2)


@router.post("/knowledge-gaps/{gap_id}/prepare-material")
def prepare_gap_material(gap_id: int):
    """
    用知識缺口的 SuggestedQuery 自動找候選資料。
    找到後寫入 agent.RagKnowledgeGapCandidate。
    這一步是「準備教材」，不是直接匯入，避免垃圾資料污染向量庫。
    """

    with get_connection() as conn:
        cur = conn.cursor()

        gap = _get_gap_by_id(cur, gap_id)

        query = gap["suggested_query"] or gap["question"] or gap["claim"]

        candidates = _pubmed_search(query, limit=5)

        if not candidates:
            cur.execute("""
                UPDATE agent.RagKnowledgeGap
                SET Status = ?
                WHERE GapId = ?
            """, "no_candidate_found", gap_id)

            conn.commit()

            return {
                "ok": False,
                "gap_id": gap_id,
                "status": "no_candidate_found",
                "message": "找不到可用候選資料，可能需要改 suggested_query 或改查其他來源。",
                "candidates": [],
            }

        # 避免同一個 gap 一直重複塞資料
        cur.execute("""
            DELETE FROM agent.RagKnowledgeGapCandidate
            WHERE GapId = ?
        """, gap_id)

        prepared = []

        for c in candidates:
            coverage_score = _simple_claim_coverage_score(
                gap["claim"],
                f"{c.get('title', '')}\n{c.get('summary', '')}"
            )

            # 用 claim coverage 調整分數
            final_score = round((float(c.get("score", 0.5)) * 0.5) + (coverage_score * 0.5), 2)

            cur.execute("""
                INSERT INTO agent.RagKnowledgeGapCandidate
                    (GapId, SourceType, Title, Url, Summary, Score)
                VALUES
                    (?, ?, ?, ?, ?, ?)
            """,
                gap_id,
                c.get("source_type"),
                c.get("title"),
                c.get("url"),
                c.get("summary"),
                final_score
            )

            prepared.append({
                **c,
                "coverage_score": coverage_score,
                "score": final_score,
            })

        cur.execute("""
            UPDATE agent.RagKnowledgeGap
            SET Status = ?
            WHERE GapId = ?
        """, "prepared", gap_id)

        conn.commit()

    return {
        "ok": True,
        "gap_id": gap_id,
        "status": "prepared",
        "message": "已自動準備候選教材，請審查後再決定是否匯入。",
        "candidates": prepared,
    }


@router.post("/knowledge-gaps/{gap_id}/recheck")
def recheck_gap(gap_id: int):
    """
    檢查目前候選資料是否有機會補上 unsupported claim。
    這一步先不重新跑完整 RAG，只先確認候選資料品質。
    真正完整重測要接你原本的 RAG + faithfulness_eval。
    """

    with get_connection() as conn:
        cur = conn.cursor()

        gap = _get_gap_by_id(cur, gap_id)

        cur.execute("""
            SELECT
                CandidateId,
                SourceType,
                Title,
                Url,
                Summary,
                Score
            FROM agent.RagKnowledgeGapCandidate
            WHERE GapId = ?
            ORDER BY Score DESC
        """, gap_id)

        rows = cur.fetchall()

        if not rows:
            cur.execute("""
                UPDATE agent.RagKnowledgeGap
                SET Status = ?
                WHERE GapId = ?
            """, "no_candidate_found", gap_id)

            conn.commit()

            return {
                "ok": False,
                "gap_id": gap_id,
                "status": "no_candidate_found",
                "message": "目前沒有候選教材，請先按準備教材。",
            }

        checked = []

        best_score = 0.0

        for r in rows:
            candidate_id = r[0]
            source_type = r[1]
            title = r[2]
            url = r[3]
            summary = r[4]
            score = float(r[5] or 0)

            coverage_score = _simple_claim_coverage_score(
                gap["claim"],
                f"{title}\n{summary}"
            )

            final_score = round((score * 0.4) + (coverage_score * 0.6), 2)

            best_score = max(best_score, final_score)

            cur.execute("""
                UPDATE agent.RagKnowledgeGapCandidate
                SET Score = ?
                WHERE CandidateId = ?
            """, final_score, candidate_id)

            checked.append({
                "candidate_id": candidate_id,
                "source_type": source_type,
                "title": title,
                "url": url,
                "summary": summary,
                "score": final_score,
                "coverage_score": coverage_score,
            })

        if best_score >= 0.65:
            new_status = "ready_to_review"
            message = "候選教材看起來可以補上部分缺口，建議人工審查後匯入。"
        else:
            new_status = "weak_candidate"
            message = "候選教材關聯性偏低，不建議直接匯入，需要重新找資料。"

        cur.execute("""
            UPDATE agent.RagKnowledgeGap
            SET Status = ?
            WHERE GapId = ?
        """, new_status, gap_id)

        conn.commit()

    return {
        "ok": True,
        "gap_id": gap_id,
        "status": new_status,
        "best_score": best_score,
        "message": message,
        "candidates": checked,
    }
    
    
def _safe_filename(text: str, max_len: int = 80) -> str:
    keep = []

    for ch in text or "":
        if ch.isalnum() or ch in ("-", "_"):
            keep.append(ch)
        elif ch in (" ", "　"):
            keep.append("_")

    name = "".join(keep).strip("_")

    if not name:
        name = "gap_material"

    return name[:max_len]


def _write_candidate_material_file(candidate: dict, gap: dict) -> str:
    """
    產生 txt 教材檔。
    實體檔案寫到 s2_agent/vectordb/materials/gap_materials。
    回傳值只回傳相對路徑，避免 index_material 判定為非法絕對路徑。
    """

    materials_dir = os.path.abspath(
        os.path.join(os.getcwd(), "s2_agent", "vectordb", "materials")
    )

    relative_dir = "gap_materials"

    abs_dir = os.path.join(materials_dir, relative_dir)
    os.makedirs(abs_dir, exist_ok=True)

    filename = (
        f"gap_{gap['gap_id']}_candidate_{candidate['candidate_id']}_"
        f"{_safe_filename(candidate.get('title') or 'gap_material')}.txt"
    )

    abs_file_path = os.path.join(abs_dir, filename)

    # 這個才要寫進 TeachingMaterial.FilePath
    relative_file_path = f"{relative_dir}/{filename}"

    content = f"""標題：{candidate.get('title') or ''}

來源類型：{candidate.get('source_type') or 'pubmed'}

來源網址：{candidate.get('url') or 'None'}

原始問題：
{gap.get('question') or ''}

待補 Claim：
{gap.get('claim') or ''}

建議搜尋語：
{gap.get('suggested_query') or ''}

教材摘要：
{candidate.get('summary') or ''}

系統備註：
本教材由 RAG 評估缺口自動準備，經管理者審查後匯入。
"""

    with open(abs_file_path, "w", encoding="utf-8") as f:
        f.write(content)

    return relative_file_path

@router.post("/gap-candidates/{candidate_id}/approve")
def approve_gap_candidate(candidate_id: int):
    """
    審查通過候選教材：
    1. 找 candidate + gap
    2. 產生 txt 教材檔
    3. 寫入 agent.TeachingMaterial
    4. 更新 candidate 狀態
    5. 呼叫 index_material(material_id)
    """

    with get_connection() as conn:
        cur = conn.cursor()

        cur.execute("""
            SELECT
                c.CandidateId,
                c.GapId,
                c.SourceType,
                c.Title,
                c.Url,
                c.Summary,
                c.Score,
                g.Question,
                g.Claim,
                g.SuggestedQuery,
                g.SourceSuggestion,
                g.Status
            FROM agent.RagKnowledgeGapCandidate c
            INNER JOIN agent.RagKnowledgeGap g
                ON c.GapId = g.GapId
            WHERE c.CandidateId = ?
        """, candidate_id)

        row = cur.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="找不到這筆候選教材")

        candidate = {
            "candidate_id": row[0],
            "gap_id": row[1],
            "source_type": row[2],
            "title": row[3],
            "url": row[4],
            "summary": row[5],
            "score": float(row[6] or 0),
        }

        gap = {
            "gap_id": row[1],
            "question": row[7],
            "claim": row[8],
            "suggested_query": row[9],
            "source_suggestion": row[10],
            "status": row[11],
        }

        if candidate["score"] < 0.45:
            raise HTTPException(
                status_code=400,
                detail="這筆候選教材分數太低，不建議匯入。請先重新找資料或重跑評估。"
            )

        file_path = _write_candidate_material_file(candidate, gap)
        material_id = str(uuid.uuid4())

        structure_json = json.dumps(
            {
                "origin": "rag_knowledge_gap",
                "gap_id": candidate["gap_id"],
                "candidate_id": candidate["candidate_id"],
                "source_type": candidate["source_type"],
                "source_url": candidate["url"],
                "score": candidate["score"],
                "question": gap["question"],
                "claim": gap["claim"],
                "suggested_query": gap["suggested_query"],
            },
            ensure_ascii=False
        )

        cur.execute("""
            INSERT INTO agent.TeachingMaterial
                (
                    MaterialId,
                    UserId,
                    Type,
                    Language,
                    Style,
                    Title,
                    StructureJson,
                    FilePath
                )
            VALUES
                (?, ?, ?, ?, ?, ?, ?, ?)
        """,
            material_id,
            "system",
            "file",
            "zh-TW",
            "auto_repair",
            candidate["title"],
            structure_json,
            file_path
        )

        cur.execute("""
            UPDATE agent.RagKnowledgeGapCandidate
            SET
                IsApproved = 1,
                ApprovedAt = ?,
                MaterialId = ?
            WHERE CandidateId = ?
        """,
            datetime.now(),
            material_id,
            candidate_id
        )

        cur.execute("""
            UPDATE agent.RagKnowledgeGap
            SET Status = ?
            WHERE GapId = ?
        """,
            "approved",
            candidate["gap_id"]
        )

        conn.commit()

    index_ok = False
    index_error = None

    try:
        from s2_agent.vectordb.ingest_materials import index_material

        index_material(material_id)
        index_ok = True

        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute("""
                UPDATE agent.RagKnowledgeGap
                SET Status = ?
                WHERE GapId = ?
            """, "indexed", candidate["gap_id"])
            conn.commit()

    except Exception as e:
        index_error = str(e)

        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute("""
                UPDATE agent.RagKnowledgeGap
                SET Status = ?
                WHERE GapId = ?
            """, "approved_index_failed", candidate["gap_id"])
            conn.commit()

    return {
        "ok": True,
        "candidate_id": candidate_id,
        "gap_id": candidate["gap_id"],
        "material_id": material_id,
        "file_path": file_path,
        "index_ok": index_ok,
        "index_error": index_error,
        "status": "indexed" if index_ok else "approved_index_failed",
        "message": "候選教材已審查匯入並完成索引。" if index_ok else "候選教材已匯入，但索引到 Qdrant 失敗。",
    }