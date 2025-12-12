# s2_agent/s0_bridge.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import os

from openai import OpenAI  # 需要 pip install openai

router = APIRouter(
    prefix="/from-s0",  # 搭配 s2_agent/router.py 的 /s2 → 最後是 /s2/from-s0/ask
    tags=["S2 Bridge"],
)

# ---------- I/O schema ----------

class AskFromS0In(BaseModel):
    imageCaseId: int
    boneId: int | None = None
    smallBoneId: int | None = None
    question: str


class AskFromS0Out(BaseModel):
    answer: str


# ---------- LLM 設定 ----------

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
USE_DEMO = not OPENAI_API_KEY  # 沒 key 就走 demo

if USE_DEMO:
    print("⚠️ [S2] 沒有 OPENAI_API_KEY，from-s0 只會回 demo 文本。")
else:
    print("✅ [S2] 將使用真正的 LLM 回答 from-s0 問題。")
    client = OpenAI(api_key=OPENAI_API_KEY)


# ---------- API ----------

@router.post("/ask", response_model=AskFromS0Out)
def ask_from_s0(body: AskFromS0In) -> AskFromS0Out:
    """
    S0 一鍵「請 Dr.Bone 解說」用的 API。
    有 OPENAI_API_KEY 時：呼叫 OpenAI LLM。
    沒有 key 時：回 demo 文本（不花錢）。
    """

    # ---- demo 模式（沒 key 的 fallback）----
    if USE_DEMO:
        demo = (
            "（目前未設定 OPENAI_API_KEY，只是示範流程，沒有真正回答）\n"
            f"imageCaseId={body.imageCaseId}, "
            f"boneId={body.boneId}, smallBoneId={body.smallBoneId}\n"
            f"問題內容：{body.question}"
        )
        return AskFromS0Out(answer=demo)

    # ---- 真正 LLM 模式 ----
    system_prompt = (
        "你是 Dr.Bone，一位擅長骨科衛教與影像解說的助理。"
        "使用者剛在 X 光影像上框選了一塊骨頭，想了解這塊骨頭的『位置、功能、常見骨折或病變』。"
        "請用台灣病人看得懂的繁體中文，條列重點、語氣溫和但專業；"
        "不要做診斷、不要誇大風險，可以提醒一定要由專業醫師判讀影像。"
    )

    # 把影像 / 骨頭 context 串在 user prompt 裡
    user_prompt = (
        f"ImageCaseId={body.imageCaseId}, "
        f"boneId={body.boneId}, smallBoneId={body.smallBoneId}\n"
        f"問題內容：{body.question}"
    )

    try:
        resp = client.chat.completions.create(
            model="gpt-4.1-mini",  # 你要改成別的 model 也可以
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        answer = resp.choices[0].message.content or ""
        return AskFromS0Out(answer=answer)

    except Exception as e:
        # 失敗就丟 HTTP 500 給前端，前端會顯示「詢問 AI 失敗：...」
        raise HTTPException(status_code=500, detail=f"S2 LLM error: {e}")
