"""研报流式生成模块（§6.4，§10）。

LLM 流式调用，每个非空 delta 通过 async generator 逐个 yield。
收集完整研报、usage 统计和首 token 时间。
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, AsyncIterator

import httpx

from app.pipeline.providers import FullSource

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT_TEMPLATE = """你是一个专业的 AI 技术研报撰写助手。请基于提供的信源资料，为以下技术问题撰写一篇专业的研报。

要求：
- 使用 Markdown 格式，结构清晰（标题、段落、列表、代码块等）
- 每个关键断言后用 [n] 标注对应信源编号（n 为数字，与信源列表对应）
- 内容准确，只写信源中有支撑的内容
- 中英文技术名词保持原文
- 不使用 emoji
- 研报长度适中，覆盖问题核心

如果信源中有评测数据，请使用 openui-lang 代码块展示，格式如下：
```openui-lang
root = Table("表格标题", [c1, c2, c3], [r1, r2])
c1 = Column("方法", "方法名称", false)
c2 = Column("指标", "数值", true)
r1 = Row({{"方法": "方案A", "指标": "100"}})
```

信源列表：
{sources_text}"""


def _build_sources_text(sources: list[FullSource]) -> str:
    """构建信源上下文文本，每个信源最多 1200 字符。"""
    parts = []
    for src in sources:
        passage = (src.passage or "")[:1200]
        parts.append(
            f"[{src.index}] {src.title}\n"
            f"URL: {src.url}\n"
            f"摘要: {passage}"
        )
    return "\n\n".join(parts)


async def generate_report(
    query: str,
    sources: list[FullSource],
    llm_base_url: str,
    llm_api_key: str,
    llm_model: str,
    client: httpx.AsyncClient,
    first_token_timeout: float = 30.0,
) -> AsyncIterator[dict[str, Any]]:
    """流式生成研报。

    Yield 字典：
    - {"type": "token", "delta": str}
    - {"type": "done", "report": str, "usage": dict | None, "first_token_ms": int | None}
    - {"type": "error", "exc": Exception}
    """
    sources_text = _build_sources_text(sources)
    system_prompt = _SYSTEM_PROMPT_TEMPLATE.format(sources_text=sources_text)

    payload = {
        "model": llm_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": query},
        ],
        "thinking": {"type": "disabled"},
        "stream": True,
        "stream_options": {"include_usage": True},
        "max_tokens": 4096,
    }

    report_parts: list[str] = []
    usage: dict[str, Any] | None = None
    first_token_ms: int | None = None
    stage_start = time.perf_counter()
    first_token_received = False

    try:
        async with client.stream(
            "POST",
            f"{llm_base_url.rstrip('/')}/chat/completions",
            json=payload,
            headers={"Authorization": f"Bearer {llm_api_key}"},
            timeout=httpx.Timeout(connect=10.0, read=first_token_timeout, write=10.0, pool=5.0),
        ) as resp:
            resp.raise_for_status()

            async for line in resp.aiter_lines():
                if not line:
                    continue
                if line.startswith(":"):
                    continue
                if not line.startswith("data: "):
                    continue

                data_str = line[6:].strip()
                if data_str == "[DONE]":
                    break

                try:
                    chunk = json.loads(data_str)
                except json.JSONDecodeError:
                    continue

                # 收集 usage（最后一个 chunk）
                if chunk.get("usage"):
                    usage = chunk["usage"]

                choices = chunk.get("choices", [])
                if not choices:
                    continue

                delta = choices[0].get("delta", {})
                content = delta.get("content", "")

                # 空串不发（M0 实测首 chunk content 是 ""）
                if not content:
                    continue

                if not first_token_received:
                    first_token_ms = int((time.perf_counter() - stage_start) * 1000)
                    first_token_received = True
                    # 超时检查已由 httpx.Timeout.read 覆盖，首 token 后 read 超时不再触发

                report_parts.append(content)
                yield {"type": "token", "delta": content}

    except httpx.ReadTimeout:
        if not first_token_received:
            yield {
                "type": "error",
                "exc": TimeoutError("生成研报超时（30 秒内没有收到首个 token）"),
                "code": 50202,
            }
            return
        # 已有部分内容，当成截断完成
        logger.warning("生成阶段读取超时，已收到部分内容")
    except httpx.HTTPStatusError as exc:
        yield {"type": "error", "exc": exc, "code": 50202}
        return
    except Exception as exc:
        yield {"type": "error", "exc": exc, "code": 50202}
        return

    report = "".join(report_parts)

    # 围栏配平检查：去除未闭合的 openui-lang 块（§9）
    report = _fix_unclosed_fences(report)

    token_stats = None
    if usage:
        token_stats = {
            "promptTokens": usage.get("prompt_tokens"),
            "completionTokens": usage.get("completion_tokens"),
            "totalTokens": usage.get("total_tokens"),
            "cachedTokens": usage.get("prompt_cache_hit_tokens", 0),
            "calls": 1,
        }

    yield {
        "type": "done",
        "report": report,
        "usage": token_stats,
        "first_token_ms": first_token_ms,
    }


def _fix_unclosed_fences(text: str) -> str:
    """检查并移除正文中未闭合的 openui-lang 围栏块（§9）。"""
    lines = text.split("\n")
    result: list[str] = []
    in_fence = False
    fence_start: int | None = None
    fence_lines: list[str] = []

    for i, line in enumerate(lines):
        if not in_fence:
            if line.strip().startswith("```openui-lang"):
                in_fence = True
                fence_start = len(result)
                fence_lines = [line]
            else:
                result.append(line)
        else:
            fence_lines.append(line)
            if line.strip() == "```":
                # 闭合，写入
                result.extend(fence_lines)
                in_fence = False
                fence_lines = []
                fence_start = None

    if in_fence:
        # 未闭合，丢弃该块
        logger.warning("发现未闭合的 openui-lang 围栏块，已从正文移除")

    return "\n".join(result)
