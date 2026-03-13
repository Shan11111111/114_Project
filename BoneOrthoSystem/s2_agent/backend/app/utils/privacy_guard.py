from __future__ import annotations

import re
from typing import Any, Dict, List

_RULES = [
    {
    "type": "name",
    "label": "姓名",
    "regex": re.compile(
        r"(?:姓名|名字|我叫|病人姓名|患者姓名|患者|病人|我是|我的名字   )\s*[:：]?\s*[\u4e00-\u9fff]{2,4}",
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
            r"\b(?:生日|出生日期|DOB|birth\s*date)\s*[:：]?\s*(?:民國)?\d{2,4}(?:年|[\/\.-])\d{1,2}(?:月|[\/\.-])\d{1,2}(?:日)?\b",
            re.I,
        ),
    },
    {
        "type": "date",
        "label": "日期",
        "regex": re.compile(
            r"\b(?:19|20)\d{2}[\/\.-](?:0?[1-9]|1[0-2])[\/\.-](?:0?[1-9]|[12]\d|3[01])\b"
            r"|\b\d{2,3}[\/\.-](?:0?[1-9]|1[0-2])[\/\.-](?:0?[1-9]|[12]\d|3[01])\b",
            re.I,
        ),
    },
    {
        "type": "medical_record_no",
        "label": "病歷號",
        "regex": re.compile(
            r"(?:病歷號|病歷編號|MRN|Chart\s*No|Record\s*No)\s*[:：]?\s*[A-Z0-9-]{4,20}",
            re.I,
        ),
    },
    {
        "type": "address",
        "label": "地址",
        "regex": re.compile(
            r"(?:地址|住址|通訊地址|我住|住在)\s*[:：]?\s*[\u4e00-\u9fff0-9]{1,}(?:市|縣)[\u4e00-\u9fff0-9]{1,}(?:區|鄉|鎮|市)[\u4e00-\u9fff0-9巷弄路街段號樓之\-–—\s]{2,}",
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
        return "[已遮罩姓名]"
    
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
        return "[已遮罩日期]"

    if hit_type == "medical_record_no":
        return "[已遮罩病歷號]"

    if hit_type == "address":
        return "[已遮罩地址]"

    if hit_type == "identifiable_code":
        return "[已遮罩編號]"

    return "[已遮罩]"


def mask_sensitive_info(text: str) -> str:
    hits = detect_sensitive_info(text)
    if not hits:
        return text

    output = text
    for hit in sorted(hits, key=lambda x: x["start"], reverse=True):
        replacement = _mask_value(hit["type"], hit["value"])
        output = output[: hit["start"]] + replacement + output[hit["end"] :]
    return output