"""查询改写模块（§6.2，§10）。

LLM 调用，输出 3–5 个子检索词。
改写失败时降级为原问题作为唯一检索词，detail.fallback = True。
"""

from __future__ import annotations

import json
import logging
import re

import httpx

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """你是一个搜索查询优化助手。请将用户的技术问题改写为 3-5 个独立的英文搜索子查询，每个子查询专注于问题的不同侧面，便于从不同角度检索信息。

要求：
- 输出格式：JSON 数组，仅包含字符串列表，无其他内容
- 每个子查询不超过 80 字符（英文），简洁、精准
- 子查询之间不要重复，覆盖不同维度（性能、实现、对比、原理等）
- 不要包含中文，但可以保留技术名词原文
- 仅输出 JSON 数组，不要解释

示例输出：
["FlashAttention-3 FP8 kernel throughput benchmark","FlashAttention-3 Hopper FP8 TFLOPS","FA3 FP8 vs cuDNN attention performance"]"""


async def rewrite_query(
    query: str,
    focus_mode: str,
    scope_filters: list[str],
    llm_base_url: str,
    llm_api_key: str,
    llm_model: str,
    client: httpx.AsyncClient,
    timeout: float = 15.0,
) -> tuple[list[str], bool, int | None]:
    """改写查询，返回 (queries, fallback, fallback_code)。

    fallback=True 表示 LLM 失败，降级为原查询。
    fallback_code 取 §12 错误码：50202。
    """
    # 构造包含 scope 约束的 Prompt
    scope_hint = ""
    if scope_filters:
        excluded = [s for s in ["preprint", "code", "spec", "docs", "blog"] if s not in scope_filters]
        if excluded:
            scope_hint = f"\n注意：不要生成含有以下类别站点关键词的查询词：{', '.join(excluded)}"

    # F15：按检索模式增加改写侧重提示
    _MODE_HINTS: dict[str, str] = {
        "academic": "\n检索模式：学术/预印本，子查询应偏向 arXiv、论文关键词、实验对比、算法原理。",
        "code": "\n检索模式：代码/仓库，子查询应偏向 GitHub、API 文档、实现示例、库版本。",
        "web": "",
    }
    mode_hint = _MODE_HINTS.get(focus_mode, "")

    user_content = f"请将以下技术问题改写为 3-5 个搜索子查询：\n{query}{mode_hint}{scope_hint}"

    payload = {
        "model": llm_model,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        "thinking": {"type": "disabled"},
        "max_tokens": 500,
        "stream": False,
    }

    try:
        resp = await client.post(
            f"{llm_base_url.rstrip('/')}/chat/completions",
            json=payload,
            headers={"Authorization": f"Bearer {llm_api_key}"},
            timeout=timeout,
        )
        resp.raise_for_status()
        data = resp.json()
        content = data["choices"][0]["message"]["content"]

        # 解析 JSON 数组
        queries = _parse_queries(content)
        if not queries:
            logger.warning("改写结果解析失败，降级: %r", content[:200])
            return [query], True, 50202

        return queries, False, None

    except httpx.TimeoutException as exc:
        logger.warning("改写超时，降级: %s", exc)
        return [query], True, 50202
    except httpx.HTTPStatusError as exc:
        logger.warning("改写 HTTP 错误 %d，降级: %s", exc.response.status_code, exc)
        return [query], True, 50202
    except Exception as exc:
        logger.warning("改写失败，降级: %s", exc)
        return [query], True, 50202


def _parse_queries(text: str) -> list[str]:
    """从 LLM 输出中提取 JSON 字符串数组。"""
    text = text.strip()

    # 直接解析
    try:
        result = json.loads(text)
        if isinstance(result, list) and all(isinstance(q, str) for q in result):
            return [q.strip() for q in result if q.strip()][:5]
    except json.JSONDecodeError:
        pass

    # 尝试提取 JSON 块
    m = re.search(r"\[.*?\]", text, re.DOTALL)
    if m:
        try:
            result = json.loads(m.group())
            if isinstance(result, list) and all(isinstance(q, str) for q in result):
                return [q.strip() for q in result if q.strip()][:5]
        except json.JSONDecodeError:
            pass

    return []
