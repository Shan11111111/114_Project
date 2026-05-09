# s2_agent/legacy_agent/backend/app/tools/intent_router.py
from __future__ import annotations

import re


def _has_any(text: str, words: list[str]) -> bool:
    return any(w and w in text for w in words)


def analyze_user_intent(question: str) -> dict:
    raw = question or ""
    q = raw.lower()

    # 明確要求 3D / 模型 / 視覺化
    model_words = [
        "3d", "3D",
        "模型", "3d模型", "立體", "三維",
        "渲染", "生成", "示意圖", "示意",
        "長怎樣", "看起來", "外觀",
        "標出來", "標示", "標記", "highlight", "focus",
        "後製", "做出來", "畫出來",
        "顯示", "展示", "打開", "開啟",
        "觀察", "查看", "看一下", "看", "我要看",
        "旋轉", "放大", "縮小", "定位",
        "骨架", "骨骼模型", "3d viewer", "viewer",
        "model", "render", "visualize", "visualise",

        # 多輪追問 / 指代
        "前面那個", "剛剛那個", "剛才那個", "上一個", "同一個",
        "再來一次", "再一次", "重來一次",
        "再給我一次", "再開一次", "再看一次", "重新顯示",
        "打開剛剛", "開剛剛", "再顯示", "再打開",
    ]

    # 病灶 / 影像標示類，也適合 3D 示意
    lesion_words = [
        "骨折", "折斷", "斷裂", "裂痕", "裂開", "破裂",
        "腫瘤", "腫塊", "病灶", "發炎", "感染",
        "退化", "磨損", "骨刺",
        "鋼釘", "鋼板", "植入物", "固定物",
    ]

    # 純文字 RAG / 衛教 / 文獻 / SOAP
    text_words = [
        "介紹", "說明", "解釋", "原因", "症狀", "治療", "衛教",
        "文獻", "研究", "pubmed", "soap", "病歷", "醫囑", "個案",
        "怎麼辦", "風險", "副作用", "診斷", "預後", "評估",
        "是什麼", "為什麼", "如何", "差異", "比較",
    ]

    # 骨頭名稱 / 解剖詞
    bone_anatomy_words = [
        "骨", "骨頭", "骨骼", "解剖",
        "顱骨", "頭骨", "鼻骨", "顴骨", "額骨", "頂骨", "枕骨", "顳骨",
        "脊椎", "頸椎", "胸椎", "腰椎", "薦椎", "尾椎",
        "鎖骨", "肩胛骨", "肱骨", "尺骨", "橈骨",
        "腕骨", "掌骨", "指骨", "近節指骨", "中節指骨", "遠節指骨",
        "肋骨", "胸骨", "骨盆", "髖骨",
        "股骨", "髕骨", "脛骨", "腓骨",
        "跗骨", "蹠骨", "趾骨", "近節趾骨", "中節趾骨", "遠節趾骨",
        "拇指", "食指", "中指", "無名指", "小指",
        "拇趾", "第二趾", "第三趾", "第四趾", "第五趾", "小趾",
        "第一", "第二", "第三", "第四", "第五",
        "proximal", "middle", "distal",
        "phalanx", "phalanges", "metacarpal", "metatarsal",
        "carpal", "tarsal",
        "femur", "tibia", "fibula", "humerus", "radius", "ulna",
    ]

    # 這些動詞搭配骨頭名稱時，代表使用者很可能想看 3D
    visual_action_words = [
        "看", "看看", "看一下", "我要看",
        "顯示", "展示", "打開", "開啟",
        "觀察", "查看", "定位", "標示", "標出",
        "在哪", "在哪裡", "位置",
        "跳到", "前往", "進入",

        # 多輪追問
        "再來一次", "再一次", "重來一次",
        "再給我一次", "再開一次", "再看一次", "重新顯示",
        "打開剛剛", "開剛剛", "再顯示", "再打開",
    ]

    # 明確否定 3D 的情境，避免使用者只想文字解釋時硬跳 modal
    text_only_words = [
        "不要3d", "不用3d", "不要模型", "不用模型",
        "只要文字", "文字就好", "不用示意圖",
    ]

    has_model_word = _has_any(raw, model_words) or _has_any(q, model_words)
    has_lesion_word = _has_any(raw, lesion_words) or _has_any(q, lesion_words)
    has_text_word = _has_any(raw, text_words) or _has_any(q, text_words)
    has_bone_word = _has_any(raw, bone_anatomy_words) or _has_any(q, bone_anatomy_words)
    has_visual_action = _has_any(raw, visual_action_words) or _has_any(q, visual_action_words)
    text_only = _has_any(raw, text_only_words) or _has_any(q, text_only_words)

    # 英文常見 3D / 模型意圖
    if re.search(r"\b(show|open|view|display|visualize|visualise|render|highlight|focus)\b", q):
        has_visual_action = True

    if re.search(r"\b(3d|model|viewer|mesh|bone model)\b", q):
        has_model_word = True

    # 英文短句追問
    if re.search(r"\b(again|one more time|do it again|show it again|open it again|view it again)\b", q):
        has_model_word = True
        has_visual_action = True

    if re.search(r"\b(third|second|fourth|fifth|first)\s+(distal|middle|proximal)\b", q):
        has_bone_word = True

    if re.search(r"\b(distal|middle|proximal)\s+(phalanx|phalanges)\b", q):
        has_bone_word = True

    # 3D 判斷：
    # 1. 明確提到模型 / 3D / 渲染
    # 2. 病灶示意，例如骨折標示
    # 3. 有骨頭詞 + 視覺動作，例如「我要看第三趾遠節趾骨」
    # 4. 很具體的 206 細項骨名，例如「第三趾遠節趾骨」即使沒說模型，也可準備 3D asset
    very_specific_small_bone = bool(
        re.search(r"第[一二三四五12345].{0,3}[指趾].{0,4}[遠近中]節", raw)
        or re.search(r"[遠近中]節[指趾]骨", raw)
        or re.search(
            r"\b(third|second|fourth|fifth|first).{0,12}(distal|middle|proximal).{0,12}(phalanx|phalanges)\b",
            q,
        )
    )

    need_3d = False
    if not text_only:
        need_3d = (
            has_model_word
            or has_lesion_word
            or (has_bone_word and has_visual_action)
            or very_specific_small_bone
        )

    # 文字回答判斷：
    # 只要問介紹/說明/原因/治療等，需要文字。
    # 如果是純「打開模型、我要看模型」，文字 RAG 可以不用。
    need_text = has_text_word or not need_3d

    # 如果是「介紹第三趾遠節趾骨」這種，最好文字 + 3D 都給
    if need_3d and (
        has_text_word
        or "介紹" in raw
        or "說明" in raw
        or "在哪" in raw
        or "位置" in raw
        or "功能" in raw
        or "是什麼" in raw
    ):
        need_text = True

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
        "debug": {
            "has_model_word": has_model_word,
            "has_lesion_word": has_lesion_word,
            "has_text_word": has_text_word,
            "has_bone_word": has_bone_word,
            "has_visual_action": has_visual_action,
            "very_specific_small_bone": very_specific_small_bone,
            "text_only": text_only,
        },
    }