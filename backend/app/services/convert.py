"""等级换算与综测明细软校验。"""
from __future__ import annotations

import re

# 综测明细「±数字」软校验求和：
# - 带 + 的数字一律视为加分项（「基础分+23」「六级成绩587分+5」中的 +23 / +5）；
# - 带 - 的数字仅当其左侧不是数字时视为减分项（避开「2024-2025」年份区间）；
# - 无符号数字（如「587分」「525嘉年华」）永不计入。
PLUS_TERM = re.compile(r"[＋+]\s*(\d+(?:\.\d+)?)")
MINUS_TERM = re.compile(r"(?<![\d.])[-−]\s*(\d+(?:\.\d+)?)")


def convert_level(level_text: str, conversion: dict[str, float]) -> float | None:
    """等级文本 → 百分制。未匹配返回 None（调用方决定异常处理）。"""
    return conversion.get(str(level_text).strip())


def parse_number(value) -> float | None:
    """数字/文本数字 → float；不可解析返回 None。"""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def sum_detail_terms(detail: str) -> float:
    total = 0.0
    for m in PLUS_TERM.finditer(str(detail or "")):
        total += float(m.group(1))
    for m in MINUS_TERM.finditer(str(detail or "")):
        total -= float(m.group(1))
    return round(total, 2)


def is_detail_mismatch(soft: float | None, score: float | None,
                       max_score: float | None = None) -> bool:
    """明细软校验：求和与得分是否不符。

    例外：求和超过该项满分、而得分恰好填了满分时，视为按封顶填写，不算不符
    （录入页与导入的明细不符提示共用此口径）。"""
    if soft is None:
        return False
    if (max_score is not None and soft - max_score > 1e-9
            and abs((score or 0) - max_score) <= 0.05):
        return False
    return abs(soft - (score or 0)) > 0.05
