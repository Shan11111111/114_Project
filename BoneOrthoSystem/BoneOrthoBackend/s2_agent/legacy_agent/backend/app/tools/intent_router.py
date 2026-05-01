# s2_agent/legacy_agent/backend/app/tools/intent_router.py

def analyze_user_intent(question: str) -> dict:
    q = (question or "").lower()

    model_words = [
        "3d", "模型", "渲染", "生成", "示意圖", "長怎樣",
        "折斷", "斷裂", "裂痕", "標出來", "後製", "做出來"
    ]

    text_words = [
        "介紹", "說明", "原因", "症狀", "治療", "衛教",
        "文獻", "研究", "pubmed", "soap", "病歷", "怎麼辦"
    ]

    need_3d = any(w in q for w in model_words) or any(w in question for w in model_words)
    need_text = any(w in q for w in text_words) or any(w in question for w in text_words)

    if need_3d and need_text:
        route = "hybrid_text_and_3d"
    elif need_3d:
        route = "model_render"
    else:
        route = "text_rag"

    return {
        "route": route,
        "need_text_rag": route in ["text_rag", "hybrid_text_and_3d"],
        "need_3d_asset": route in ["model_render", "hybrid_text_and_3d"],
    }