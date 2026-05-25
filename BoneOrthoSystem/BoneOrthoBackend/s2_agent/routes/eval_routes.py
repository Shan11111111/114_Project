from fastapi import APIRouter
from pydantic import BaseModel
from typing import List

from s2_agent.evals.faithfulness_eval import (
    evaluate_faithfulness
)

router = APIRouter(prefix="/eval", tags=["eval"])


class FaithfulnessRequest(BaseModel):
    question: str
    answer: str
    contexts: List[str]


@router.post("/faithfulness")
def eval_faithfulness(req: FaithfulnessRequest):

    result = evaluate_faithfulness(
        question=req.question,
        answer=req.answer,
        contexts=req.contexts,
    )

    return result