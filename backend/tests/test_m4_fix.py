"""M4 修复补充测试。

覆盖三个修复点：
1. 回放写历史 trace_events 正确序列化（不再是空列表）
2. L1 命中时 sources.engine 是真实引擎名，不含 (cached) 后缀
3. 中止日志在真实路径（queue 有背压）下能出现
"""
from __future__ import annotations

import asyncio
import json
import time
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.cache import reset_caches


# ---------------------------------------------------------------------------
# 辅助：构造最小可用的 SearchState（供回放测试用）
# ---------------------------------------------------------------------------


def _make_minimal_replay_payload() -> dict[str, Any]:
    """构造一个能通过 _replay_cache 写库的最小 cache_payload。"""
    from app.pipeline.providers import RawSource, FullSource

    raw = RawSource(
        id="r1", title="Title", url="https://example.com/1",
        domain="example.com", favicon_url=None, engine="tavily",
        category="preprint", category_source="rule", confidence=0.9,
        published_at=None,
    )
    raw._matched_queries = [0]

    full = FullSource(
        id="r1", index=1, title="Title", url="https://example.com/1",
        domain="example.com", favicon_url=None, engine="tavily",
        category="preprint", category_source="rule", category_rule=None,
        confidence=0.9, published_at=None, passage="Test passage.",
        passage_truncated=False,
        scores={"final": 0.9, "relevance": 0.9, "authority": 0.0, "recency": 0.0},
        engine_signals={}, matched_queries=[0], bibtex=None, pdf_url=None,
    )

    return {
        "rewritten_queries": ["sub query"],
        "all_raw": [raw],
        "ranked_sources": [full],
        "engines_used": ["tavily"],
        "degraded": False,
        "report_text": "研报正文 [1] 第二句。第三句。",
        "citations": [
            {
                "index": 1,
                "markerStart": 15,
                "markerEnd": 18,
                "sentenceStart": 0,
                "sentenceEnd": 20,
                "highlight": None,
            }
        ],
        "takeaways": None,
        "follow_ups": ["相关问题1"],
        "consensus": {"score": 0.5, "supportedSentences": 1, "citedSentences": 2},
        "token_stats": {"promptTokens": 100, "completionTokens": 50, "totalTokens": 150},
        "trace_events": [],
    }


# ---------------------------------------------------------------------------
# 修复1：回放写历史 trace_events 序列化
# ---------------------------------------------------------------------------


class TestReplayHistoryWrite:
    @pytest.mark.asyncio
    async def test_replay_trace_events_is_json_string(self, monkeypatch):
        """回放写库时 trace_events 必须是 JSON 字符串，包含 cacheHit=true 的 trace。"""
        import os, json as _json
        from app.config import get_settings
        from app.cache import reset_caches, set_l2_cache
        from app.pipeline.stream import _make_l2_key
        from app.pipeline.providers import RawSource, FullSource
        from unittest.mock import MagicMock, AsyncMock, patch
        from fastapi import Request
        from app.pipeline import stream as stream_mod

        monkeypatch.setenv("CACHE_ENABLED", "true")
        monkeypatch.setenv("HEARTBEAT_INTERVAL_S", "10")
        monkeypatch.setenv("TAVILY_API_KEY", "fake")
        monkeypatch.setenv("LLM_API_KEY", "fake")
        get_settings.cache_clear()
        reset_caches()

        raw = RawSource(
            id="r1", title="Title", url="https://example.com/1",
            domain="example.com", favicon_url=None, engine="tavily",
            category="preprint", category_source="rule", confidence=0.9,
            published_at=None,
        )
        raw._matched_queries = [0]
        full = FullSource(
            id="r1", index=1, title="Title", url="https://example.com/1",
            domain="example.com", favicon_url=None, engine="tavily",
            category="preprint", category_source="rule", category_rule=None,
            confidence=0.9, published_at=None, passage="Test passage.",
            passage_truncated=False,
            scores={"final": 0.9, "relevance": 0.9, "authority": 0.0, "recency": 0.0},
            engine_signals={}, matched_queries=[0], bibtex=None, pdf_url=None,
        )

        payload = {
            "rewritten_queries": ["sub query"],
            "all_raw": [raw],
            "ranked_sources": [full],
            "engines_used": ["tavily"],
            "degraded": False,
            "report_text": "研报正文 [1] 第二句。第三句。",
            "citations": [{"index": 1, "markerStart": 15, "markerEnd": 18,
                           "sentenceStart": 0, "sentenceEnd": 20, "highlight": None}],
            "takeaways": None,
            "follow_ups": ["问题1"],
            "consensus": None,
            "token_stats": None,
            "trace_events": [],
        }

        l2_key = _make_l2_key("replay db test", "web", "tavily", [])
        set_l2_cache(l2_key, payload)

        written_rows: list[dict] = []

        async def fake_insert(row: dict) -> None:
            written_rows.append(row)

        mock_request = MagicMock(spec=Request)
        mock_request.is_disconnected = AsyncMock(return_value=False)

        with patch("app.pipeline._cache.insert_history", fake_insert):
            frames: list[str] = []
            async for frame in stream_mod.run_pipeline(
                request=mock_request,
                query="replay db test",
                focus_mode="web",
                engine="tavily",
                scope_filters=[],
            ):
                frames.append(frame)

        assert len(written_rows) == 1, f"写库应调用 1 次，实际 {len(written_rows)} 次"
        row = written_rows[0]

        # trace_events 必须是 JSON 字符串
        te = row["trace_events"]
        assert isinstance(te, str), f"trace_events 应为 JSON 字符串，类型: {type(te)}"
        parsed = _json.loads(te)
        assert isinstance(parsed, list), "解析后应为列表"
        assert len(parsed) > 0, "trace_events 不应为空"
        for item in parsed:
            assert item.get("cacheHit") is True, f"回放 trace 应 cacheHit=true: {item}"

        # done 帧的 historyId 不为 null
        done_data = None
        for f in frames:
            if "historyId" in f and "cacheHit" in f:
                import re
                m = re.search(r"data:(.+)", f)
                if m:
                    try:
                        d = _json.loads(m.group(1))
                        if "historyId" in d:
                            done_data = d
                    except Exception:
                        pass

        assert done_data is not None, f"未找到 done 帧, 共 {len(frames)} 帧"
        assert done_data.get("historyId") is not None, "done.historyId 不应为 null"
        assert done_data.get("cacheHit") is True, "done.cacheHit 应为 true"

        get_settings.cache_clear()
        reset_caches()
        monkeypatch.delenv("CACHE_ENABLED", raising=False)
        monkeypatch.delenv("HEARTBEAT_INTERVAL_S", raising=False)
        monkeypatch.delenv("TAVILY_API_KEY", raising=False)
        monkeypatch.delenv("LLM_API_KEY", raising=False)


class TestL1EngineField:
    @pytest.mark.asyncio
    async def test_l1_hit_engine_has_no_cached_suffix(self, monkeypatch):
        """L1 命中时 sources(raw) 里的 engine 是真实引擎名，不含 (cached) 后缀。"""
        monkeypatch.setenv("CACHE_ENABLED", "true")
        monkeypatch.setenv("HEARTBEAT_INTERVAL_S", "10")
        monkeypatch.setenv("TAVILY_API_KEY", "fake")
        monkeypatch.setenv("LLM_API_KEY", "fake-llm")
        from app.config import get_settings
        get_settings.cache_clear()
        reset_caches()

        from app.pipeline.providers import RawSource
        from app.cache import set_l1_cache
        from app.pipeline.stream import _make_l1_key

        raw = RawSource(
            id="r1", title="T", url="https://example.com/1",
            domain="example.com", favicon_url=None, engine="tavily",
            category="preprint", category_source="rule", confidence=0.9,
            published_at=None,
        )

        async def fake_rewrite(**kwargs):
            return ["sub q1"], False, None

        # 预先填 L1 缓存
        l1_key = _make_l1_key("tavily", [], "sub q1")
        set_l1_cache(l1_key, [raw])

        from fastapi import Request
        mock_request = MagicMock(spec=Request)
        mock_request.is_disconnected = AsyncMock(return_value=False)

        from app.pipeline import stream as stream_mod

        frames: list[str] = []
        with patch("app.pipeline._pipeline.rewrite_query", fake_rewrite):
            with patch("app.pipeline._pipeline.TavilyProvider") as mock_prov_cls:
                mock_prov = MagicMock()
                mock_prov.engine_name = "tavily"
                # search 永远不会被调用（L1 命中）
                mock_prov.search = AsyncMock(side_effect=Exception("不应调用真实检索"))
                mock_prov_cls.return_value = mock_prov

                gen = stream_mod.run_pipeline(
                    request=mock_request,
                    query="l1 test",
                    focus_mode="web",
                    engine="tavily",
                    scope_filters=[],
                )
                async for frame in gen:
                    frames.append(frame)
                    if "error" in frame or ("sources" in frame and "ranked" in frame):
                        # 拿到 ranked sources 或 error 后可以继续等完成
                        pass

        # 收集所有 sources raw 帧
        raw_source_frames = []
        for f in frames:
            if '"phase":"raw"' in f:
                import re
                m = re.search(r'data:(.+)', f)
                if m:
                    try:
                        data = json.loads(m.group(1))
                        raw_source_frames.append(data)
                    except Exception:
                        pass

        assert len(raw_source_frames) > 0, f"未找到 sources raw 帧，frames={[f[:60] for f in frames]}"
        for data in raw_source_frames:
            eng = data.get("engine", "")
            assert "(cached)" not in eng, f"engine 字段不应含 (cached)，实际: {eng!r}"
            assert eng in ("tavily", "deepseek"), f"engine 应为合法枚举值，实际: {eng!r}"

        get_settings.cache_clear()
        reset_caches()
        monkeypatch.delenv("CACHE_ENABLED", raising=False)
        monkeypatch.delenv("HEARTBEAT_INTERVAL_S", raising=False)
        monkeypatch.delenv("TAVILY_API_KEY", raising=False)
        monkeypatch.delenv("LLM_API_KEY", raising=False)

    @pytest.mark.asyncio
    async def test_l1_hit_does_not_trigger_degraded(self, monkeypatch):
        """L1 命中不触发 searching degraded 事件。"""
        monkeypatch.setenv("CACHE_ENABLED", "true")
        monkeypatch.setenv("HEARTBEAT_INTERVAL_S", "10")
        monkeypatch.setenv("TAVILY_API_KEY", "fake")
        monkeypatch.setenv("LLM_API_KEY", "fake-llm")
        from app.config import get_settings
        get_settings.cache_clear()
        reset_caches()

        from app.pipeline.providers import RawSource
        from app.cache import set_l1_cache
        from app.pipeline.stream import _make_l1_key

        raw = RawSource(
            id="r1", title="T", url="https://example.com/1",
            domain="example.com", favicon_url=None, engine="tavily",
            category="preprint", category_source="rule", confidence=0.9,
            published_at=None,
        )

        async def fake_rewrite(**kwargs):
            return ["sub q1", "sub q2"], False, None

        # 只给 sub q1 填 L1 缓存
        l1_key = _make_l1_key("tavily", [], "sub q1")
        set_l1_cache(l1_key, [raw])

        from fastapi import Request
        mock_request = MagicMock(spec=Request)
        mock_request.is_disconnected = AsyncMock(return_value=False)

        from app.pipeline import stream as stream_mod

        frames: list[str] = []
        with patch("app.pipeline._pipeline.rewrite_query", fake_rewrite):
            with patch("app.pipeline._pipeline.TavilyProvider") as mock_prov_cls:
                mock_prov = MagicMock()
                mock_prov.engine_name = "tavily"
                # sub q2 正常返回
                mock_prov.search = AsyncMock(return_value=[raw])
                mock_prov_cls.return_value = mock_prov

                gen = stream_mod.run_pipeline(
                    request=mock_request,
                    query="l1 no degraded test",
                    focus_mode="web",
                    engine="tavily",
                    scope_filters=[],
                )
                async for frame in gen:
                    frames.append(frame)

        # 不应出现 degraded 帧
        degraded_frames = [f for f in frames if '"status":"degraded"' in f]
        assert len(degraded_frames) == 0, f"L1 命中不应触发 degraded，实际: {degraded_frames}"

        get_settings.cache_clear()
        reset_caches()
        monkeypatch.delenv("CACHE_ENABLED", raising=False)
        monkeypatch.delenv("HEARTBEAT_INTERVAL_S", raising=False)
        monkeypatch.delenv("TAVILY_API_KEY", raising=False)
        monkeypatch.delenv("LLM_API_KEY", raising=False)


# ---------------------------------------------------------------------------
# 修复3：中止日志在 queue 背压下真正出现
# ---------------------------------------------------------------------------


class TestAbortLogWithBackpressure:
    @pytest.mark.asyncio
    async def test_abort_log_with_queue_backpressure(self, monkeypatch, caplog):
        """queue maxsize=32 有背压时，_pipeline_task 能响应 cancel，日志出现。"""
        import logging
        monkeypatch.setenv("CACHE_ENABLED", "false")
        monkeypatch.setenv("HEARTBEAT_INTERVAL_S", "10")
        monkeypatch.setenv("SEARCH_TIMEOUT_S", "30")   # 搜索超时设长，确保断开发生在检索进行中
        monkeypatch.setenv("TAVILY_API_KEY", "fake-bp")
        monkeypatch.setenv("LLM_API_KEY", "fake-bp")
        from app.config import get_settings
        get_settings.cache_clear()

        from app.pipeline import stream as stream_mod

        async def fake_rewrite(**kwargs):
            return ["q1", "q2", "q3"], False, None

        # 搜索需要 5 秒，断开在第一帧出现 0.5s 后（确保到检索阶段）
        async def fake_search(q, count=10, exclude_categories=None):
            await asyncio.sleep(5)
            return []

        pipeline_started = asyncio.Event()
        pipeline_start_time: list[float] = []
        disconnect_after = 0.5  # 第一帧出现后 0.5s 断开，改写已完成，检索中

        async def is_disconnected_mock():
            if not pipeline_started.is_set():
                return False
            return time.perf_counter() - pipeline_start_time[0] > disconnect_after

        start_time = time.perf_counter()

        from fastapi import Request
        mock_request = MagicMock(spec=Request)
        mock_request.is_disconnected = is_disconnected_mock

        with caplog.at_level(logging.INFO, logger="app.pipeline.stream"):
            with patch("app.pipeline._pipeline.rewrite_query", fake_rewrite):
                with patch("app.pipeline._pipeline.TavilyProvider") as mock_cls:
                    mock_prov = MagicMock()
                    mock_prov.engine_name = "tavily"
                    mock_prov.search = AsyncMock(side_effect=fake_search)
                    mock_cls.return_value = mock_prov

                    gen = stream_mod.run_pipeline(
                        request=mock_request,
                        query="backpressure abort test",
                        focus_mode="web",
                        engine="tavily",
                        scope_filters=[],
                    )
                    frames: list[str] = []
                    try:
                        async for frame in gen:
                            frames.append(frame)
                            if not pipeline_started.is_set():
                                pipeline_started.set()
                                pipeline_start_time.append(time.perf_counter())
                            if time.perf_counter() - start_time > 6.0:
                                break
                    except Exception:
                        pass

        log_text = " ".join(caplog.messages)
        assert "客户端已断开" in log_text, f"日志未含断开提示，日志: {caplog.messages}"
        assert "阶段=" in log_text, f"日志未含阶段字段，日志: {caplog.messages}"

        get_settings.cache_clear()
        monkeypatch.delenv("CACHE_ENABLED", raising=False)
        monkeypatch.delenv("HEARTBEAT_INTERVAL_S", raising=False)
        monkeypatch.delenv("SEARCH_TIMEOUT_S", raising=False)
        monkeypatch.delenv("TAVILY_API_KEY", raising=False)
        monkeypatch.delenv("LLM_API_KEY", raising=False)
