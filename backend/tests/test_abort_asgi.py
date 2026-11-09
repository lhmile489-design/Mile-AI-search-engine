"""任务 1：验证中止路径在 run_pipeline 生成器层面的行为。

ASGITransport 下 body_iterator 的 aclose() 不被可靠调用，
所以改为直接调用 run_pipeline() 生成器并模拟断开，
这与 httpx_transport_path 的 _disconnect_watcher 覆盖互补。
"""
import asyncio
import logging
import os
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio

os.environ.setdefault("TAVILY_API_KEY", "fake_asgi")
os.environ.setdefault("LLM_API_KEY", "fake_asgi")


@pytest.mark.asyncio
async def test_disconnect_watcher_cancels_pipeline(monkeypatch, caplog):
    """_disconnect_watcher 检测到断开后，_pipeline_task 被 cancel，日志出现。

    模拟方式：mock request.is_disconnected 在第一帧后 0.3s 返回 True，
    fake_search sleep 5s 确保还在检索阶段。
    """
    monkeypatch.setenv("CACHE_ENABLED", "false")
    monkeypatch.setenv("HEARTBEAT_INTERVAL_S", "30")
    monkeypatch.setenv("SEARCH_TIMEOUT_S", "30")
    from app.config import get_settings
    get_settings.cache_clear()

    from app.pipeline import stream as stream_mod
    from fastapi import Request

    first_frame_at: list[float] = []

    async def fake_rewrite(**kwargs):
        return ["q1", "q2"], False, None

    async def fake_search(q, count=10, exclude_categories=None):
        await asyncio.sleep(5)
        return []

    async def is_disconnected():
        if not first_frame_at:
            return False
        return time.perf_counter() - first_frame_at[0] > 0.3

    mock_req = MagicMock(spec=Request)
    mock_req.is_disconnected = is_disconnected

    with caplog.at_level(logging.WARNING, logger="app.pipeline.stream"):
        with patch("app.pipeline._pipeline.rewrite_query", fake_rewrite):
            with patch("app.pipeline._pipeline.TavilyProvider") as mock_cls:
                prov = MagicMock()
                prov.engine_name = "tavily"
                prov.search = AsyncMock(side_effect=fake_search)
                mock_cls.return_value = prov

                gen = stream_mod.run_pipeline(
                    request=mock_req,
                    query="watcher cancel test",
                    focus_mode="web",
                    engine="tavily",
                    scope_filters=[],
                )
                t0 = time.perf_counter()
                async for frame in gen:
                    if not first_frame_at:
                        first_frame_at.append(time.perf_counter())
                    if time.perf_counter() - t0 > 5:
                        break

    log_text = " ".join(caplog.messages)
    assert "客户端已断开" in log_text, f"日志: {caplog.messages}"
    assert "阶段=" in log_text, f"日志: {caplog.messages}"

    get_settings.cache_clear()
