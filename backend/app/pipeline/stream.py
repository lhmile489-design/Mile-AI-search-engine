"""SSE 流水线对外入口（run_pipeline）。

架构：
- _pipeline_task（app.pipeline._pipeline）：把完整流水线逻辑封装为 asyncio.Task，
  把每帧（str）put 进队列；结束时 put(None) 作哨兵。
- run_pipeline：对外的 AsyncIterator，从队列 get 帧 yield；
  队列空超时时发 `: ping`；生成器关闭或请求取消时，通过 _disconnect_watcher
  和 finally 两条路都会 task.cancel()，确保日志出现。

各内部模块：
  _frames.py      帧格式化与 SourceCard 序列化
  _cache.py       缓存键生成与 L2 回放
  _pipeline.py    _pipeline_task（主流水线）
  stream.py       本文件，run_pipeline（入口）
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import Any, AsyncIterator

from fastapi import Request

from app.config import get_settings
from app.pipeline._cache import _make_l2_key, _make_l1_key  # noqa: F401 (重新导出，供测试使用)
from app.pipeline._pipeline import _pipeline_task
from app.pipeline.providers.tavily import TavilyProvider  # noqa: F401 (供测试 patch)
from app.pipeline.rewriter import rewrite_query  # noqa: F401 (供测试 patch)

logger = logging.getLogger(__name__)


async def run_pipeline(
    request: Request,
    query: str,
    focus_mode: str,
    engine: str,
    scope_filters: list[str],
) -> AsyncIterator[str]:
    """对外 AsyncIterator：从队列 get 帧 yield；队列空超时时发 ping；断开时取消流水线任务。

    修复（M5 任务 1）：
    Starlette StreamingResponse 被取消时，async for 内部收到 CancelledError，
    但不一定调用 aclose()，GeneratorExit 不可靠。
    改为：额外启动 _disconnect_watcher 任务，持续轮询 request.is_disconnected()，
    一旦断开立即 cancel 流水线任务。run_pipeline 生成器的 finally 也 cancel（双保险）。
    """
    settings = get_settings()
    t0 = time.perf_counter()
    request_id = str(uuid.uuid4())[:8]

    logger.info("[%s] 开始检索: %r mode=%s engine=%s", request_id, query, focus_mode, engine)

    # L2 缓存检查
    cache_payload: dict[str, Any] | None = None
    if settings.cache_enabled:
        from app.cache import get_l2_cached
        l2_key = _make_l2_key(query, focus_mode, engine, scope_filters)
        cache_payload = get_l2_cached(l2_key)
        if cache_payload is not None:
            logger.info("[%s] L2 缓存命中: %s", request_id, l2_key[:16])

    # maxsize=32：消费者停止后 put 阻塞，配合 _disconnect_watcher 能真正打断流水线
    queue: asyncio.Queue[str | None] = asyncio.Queue(maxsize=32)

    task = asyncio.create_task(
        _pipeline_task(
            request=request,
            query=query,
            focus_mode=focus_mode,
            engine=engine,
            scope_filters=scope_filters,
            queue=queue,
            request_id=request_id,
            t0=t0,
            cache_payload=cache_payload,
        )
    )

    async def _disconnect_watcher() -> None:
        """持续轮询断开状态，检测到断开后立即取消流水线任务。"""
        while not task.done():
            await asyncio.sleep(0.5)
            try:
                if await request.is_disconnected():
                    logger.debug("[%s] disconnect_watcher 检测到断开，取消流水线任务", request_id)
                    if not task.done():
                        task.cancel()
                    return
            except Exception:
                pass

    watcher = asyncio.create_task(_disconnect_watcher())

    hb_interval = settings.heartbeat_interval_s

    try:
        while True:
            try:
                frame = await asyncio.wait_for(queue.get(), timeout=hb_interval)
            except asyncio.TimeoutError:
                yield ": ping\n\n"
                continue

            if frame is None:
                break
            yield frame

    except (GeneratorExit, asyncio.CancelledError):
        pass  # 正常退出路径，task.cancel() 在 finally 里处理
    finally:
        # 双保险：生成器关闭时也 cancel（覆盖 Starlette aclose() 调用场景）
        if not task.done():
            task.cancel()
        watcher.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
        try:
            await watcher
        except (asyncio.CancelledError, Exception):
            pass
