from __future__ import annotations

import re
from typing import Any, Dict, List

_RULES = [
    {
        "type": "name",
        "label": "姓名",
        "regex": re.compile(
            r"(?:姓名叫|名字是|我叫|病人姓名是|患者姓名是|我是|我的名字|我叫做)\s*[:：]?\s*[\u4e00-\u9fff]{2,4}",
            re.I,
        ),
    },
    {
        "type": "email",
        "label": "Email",
        "regex": re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I),
    },
    {
        "type": "phone",
        "label": "電話",
        "regex": re.compile(
            r"(?:\+886[-\s]?)?0\d{1,2}[-\s]?\d{6,8}|\b09\d{2}[-\s]?\d{3}[-\s]?\d{3}\b",
            re.I,
        ),
    },
    {
        "type": "taiwan_id",
        "label": "身分證字號",
        "regex": re.compile(r"\b[A-Z][12]\d{8}\b", re.I),
    },
    {
        "type": "birthday",
        "label": "生日",
        "regex": re.compile(
            r"(?:生日是|出生日期是|我的生日是|DOB|birth\s*date)\s*[:：]?\s*"
            r"(?:(?:民國)?\d{2,4}(?:年|[\/\.-])\d{1,2}(?:月|[\/\.-])\d{1,2}(?:日)?"
            r"|\d{1,2}[\/\.-]\d{1,2}"
            r"|\d{1,2}月\d{1,2}(?:日|號)?"
            r"|(?:十[一二]?|[一二三四五六七八九]|十一|十二|兩)月"
            r"(?:三十一|三十|二十九|二十八|二十七|二十六|二十五|二十四|二十三|二十二|二十一|二十|十九|十八|十七|十六|十五|十四|十三|十二|十一|十|九|八|七|六|五|四|三|二|一)(?:日|號)?)",
            re.I,
        ),
    },
    {
        "type": "medical_record_no",
        "label": "病歷號",
        "regex": re.compile(
            r"(?:病歷號|病歷編號|我的病歷號是|病歷號是|我的病歷號|MRN|Chart\s*No|Record\s*No)\s*[:：]?\s*(\d{9}[A-Z])\b",
            re.I,
        ),
    },
    {
        "type": "address",
        "label": "地址",
        "regex": re.compile(
            r"(?:地址是|住址是|通訊地址在|我住|住在)\s*[:：]?\s*[\u4e00-\u9fff0-9]{1,}(?:市|縣)[\u4e00-\u9fff0-9]{1,}(?:區|鄉|鎮|市)[\u4e00-\u9fff0-9巷弄路街段號樓之\-–—\s]{2,}",
            re.I,
        ),
    },
    {
        "type": "address",
        "label": "地址",
        "regex": re.compile(
            r"[\u4e00-\u9fff]{2,}(?:市|縣)[\u4e00-\u9fff]{1,}(?:區|鄉|鎮|市)[\u4e00-\u9fff0-9巷弄路街段號樓之\-–—\s]{3,}\d+號?",
            re.I,
        ),
    },
    {
        "type": "identifiable_code",
        "label": "可識別編號",
        "regex": re.compile(
            r"(?:學號|員工編號|患者編號|病患編號|個案編號|病例編號|編號|ID)\s*[:：]?\s*[A-Z0-9-]{4,20}",
            re.I,
        ),
    },
]


def detect_sensitive_info(text: str) -> List[Dict[str, Any]]:
    if not text or not text.strip():
        return []

    hits: List[Dict[str, Any]] = []
    for rule in _RULES:
        for match in rule["regex"].finditer(text):
            hits.append(
                {
                    "type": rule["type"],
                    "label": rule["label"],
                    "value": match.group(0),
                    "start": match.start(),
                    "end": match.end(),
                }
            )

    dedup = {}
    for hit in hits:
        key = (hit["type"], hit["start"], hit["end"], hit["value"])
        dedup[key] = hit

    return sorted(dedup.values(), key=lambda x: x["start"])


def _mask_value(hit_type: str, value: str) -> str:
    if hit_type == "name":
        return "患者"

    if hit_type == "email":
        parts = value.split("@")
        if len(parts) != 2:
            return "[已遮罩Email]"
        name, domain = parts
        safe_name = f"{name[:2]}***" if len(name) > 2 else f"{name[:1]}***"
        return f"{safe_name}@{domain}"

    if hit_type == "phone":
        digits = re.sub(r"[^\d]", "", value)
        if len(digits) < 6:
            return "[已遮罩電話]"
        return f"{digits[:3]}****{digits[-2:]}"

    if hit_type == "taiwan_id":
        return f"{value[:1]}*******{value[-2:]}"

    if hit_type in {"date", "birthday"}:
        return "患者生日"

    if hit_type == "medical_record_no":
        return "患者病歷號"

    if hit_type == "address":
        return "地址"

    if hit_type == "identifiable_code":
        return "編號"

    return "[已遮罩]"


def normalize_legacy_masked_text(text: str) -> str:
    if not text:
        return text

    return (
        text.replace("[已遮罩姓名]", "患者")
        .replace("[已遮罩名字]", "患者")
        .replace("[已遮罩病人姓名]", "患者")
        .replace("[已遮罩患者姓名]", "患者")
        .replace("[已遮罩地址]", "地址")
        .replace("[已遮罩日期]", "患者生日")
        .replace("[已遮罩病歷號]", "患者病歷號")
        .replace("[已遮罩編號]", "編號")
    )


def mask_sensitive_info(text: str) -> str:
    hits = detect_sensitive_info(text)
    if not hits:
        return normalize_legacy_masked_text(text)

    output = text
    for hit in sorted(hits, key=lambda x: x["start"], reverse=True):
        replacement = _mask_value(hit["type"], hit["value"])
        output = output[: hit["start"]] + replacement + output[hit["end"] :]

    return normalize_legacy_masked_text(output)