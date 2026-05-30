# eval_dashboard_routes.py
from fastapi import APIRouter
from db import get_connection

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