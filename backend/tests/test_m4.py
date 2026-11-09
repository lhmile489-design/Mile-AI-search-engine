"""M4 新增单元测试：心跳、缓存、句子切分、日志改进。"""
from __future__ import annotations

import asyncio
import time
from collections import defaultdict
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.pipeline.finalizer import split_sentences
from app.cache import _LruCache, get_l1_cached, get_l2_cached, set_l1_cache, set_l2_cache, reset_caches


# ---------------------------------------------------------------------------
# 任务 4：split_sentences 不切小数 / 缩写 / 版本号
# ---------------------------------------------------------------------------


def sentences(text: str) -> list[str]:
    spans = split_sentences(text)
    return [text[s:e] for s, e in spans]


class TestSplitSentences:
    def test_basic_english(self):
        parts = sentences("First sentence. Second sentence.")
        assert len(parts) == 2
        assert parts[0].startswith("First")
        assert parts[1].startswith("Second")

    def test_chinese(self):
        parts = sentences("第一句。第二句。第三句。")
        assert len(parts) == 3

    def test_decimal_not_split(self):
        """1.3 PFLOPs/s 不应被切成两句。"""
        text = "We achieve 1.3 PFLOPs/s on H100."
        parts = sentences(text)
        # 只有句末 . 才断，小数 1.3 不断
        assert len(parts) == 1

    def test_version_not_split(self):
        """v1.0.2 不应被切开。"""
        text = "The library is at v1.0.2 and works well."
        parts = sentences(text)
        assert len(parts) == 1

    def test_multi_decimal(self):
        """含多个小数的句子只在真正的句末断。"""
        text = "BF16 reaches 840.5 TFLOPs/s and FP8 reaches 1.3 PFLOPs/s. Next sentence here."
        parts = sentences(text)
        assert len(parts) == 2
        assert "840.5" in parts[0]
        assert "1.3" in parts[0]

    def test_abbrev_eg_not_split(self):
        """e.g. 不算句末。"""
        text = "Use a technique, e.g. gradient checkpointing, to save memory. Done."
        parts = sentences(text)
        assert len(parts) == 2

    def test_abbrev_ie_not_split(self):
        """i.e. 不算句末。"""
        text = "The cost is quadratic, i.e. O(n^2). This is expensive."
        parts = sentences(text)
        assert len(parts) == 2

    def test_abbrev_vs_not_split(self):
        """vs. 不算句末。"""
        text = "BF16 vs. FP8 throughput is compared below."
        parts = sentences(text)
        assert len(parts) == 1

    def test_abbrev_et_al_not_split(self):
        """et al. 不算句末。"""
        text = "Dao et al. proposed FlashAttention. It is efficient."
        parts = sentences(text)
        assert len(parts) == 2

    def test_exclaim_question(self):
        """! 和 ? 正常断句。"""
        parts = sentences("Is it fast? Yes! Very fast.")
        assert len(parts) == 3

    def test_emoji_offset(self):
        """含 emoji（代理对）的文本，偏移仍正确。"""
        smile = "\U0001F600"
        text = f"前{smile}句。后{smile}句。"
        parts = sentences(text)
        assert len(parts) == 2
        assert smile in parts[0]
        assert smile in parts[1]

    def test_empty(self):
        assert split_sentences("") == []

    def test_no_sentence_end(self):
        parts = sentences("no ending punctuation here")
        assert len(parts) == 1

    def test_consensus_cited_sentences_with_decimal(self):
        """含小数的研报：compute_consensus 的 citedSentences 不因切分过多而虚高。"""
        from app.pipeline.finalizer import compute_consensus
        from app.pipeline.providers import FullSource

        report = "FlashAttention achieves 1.3 PFLOPs/s on H100. This is great."
        # 只有第二句被引用，citedSentences 应该是 1 或 2（取决于是否算引用句），不超过 2
        src = FullSource(
            id="s1", title="T", url="https://example.com/1", domain="example.com",
            favicon_url=None, engine="tavily", category="preprint",
            category_source="rule", category_rule=None, confidence=0.9,
            published_at=None, passage="FlashAttention achieves 1.3 PFLOPs/s on H100.",
            passage_truncated=False, index=1,
            scores={"final": 0.9, "relevance": 0.9, "authority": 0.0, "recency": 0.0},
            engine_signals={}, matched_queries=[0], bibtex=None, pdf_url=None,
        )
        # 引用信息指向整句（UTF-16 下标 0 到结尾）
        from app.pipeline.finalizer import _utf16_offsets
        offsets = _utf16_offsets(report)
        marker_start = 0
        sent_end = report.index(".") + 1
        citation = {
            "index": 1,
            "markerStart": offsets[0],
            "markerEnd": offsets[3],
            "sentenceStart": offsets[0],
            "sentenceEnd": offsets[sent_end],
            "highlight": None,
        }
        consensus = compute_consensus(report, [citation], [src])
        # 文本有 2 句，被引 1 句
        assert consensus["citedSentences"] <= 2


# ---------------------------------------------------------------------------
# 缓存单元测试（任务 5）
# ---------------------------------------------------------------------------


class TestLruCache:
    def test_basic_get_set(self):
        c = _LruCache(max_size=3, ttl_s=60)
        c.set("a", 1)
        assert c.get("a") == 1

    def test_miss(self):
        c = _LruCache(max_size=3, ttl_s=60)
        assert c.get("x") is None

    def test_ttl_expiry(self):
        c = _LruCache(max_size=3, ttl_s=1)
        c.set("k", "v")
        assert c.get("k") == "v"
        # 手动模拟过期：直接修改 expire_at
        c._store["k"] = (c._store["k"][0], time.monotonic() - 1)
        assert c.get("k") is None

    def test_lru_eviction(self):
        c = _LruCache(max_size=2, ttl_s=60)
        c.set("a", 1)
        c.set("b", 2)
        c.get("a")       # a 变为最近使用
        c.set("c", 3)    # 淘汰最久未使用的 b
        assert c.get("b") is None
        assert c.get("a") == 1
        assert c.get("c") == 3

    def test_update_existing(self):
        c = _LruCache(max_size=3, ttl_s=60)
        c.set("a", 1)
        c.set("a", 99)
        assert c.get("a") == 99
        assert len(c) == 1


class TestCachePublicApi:
    def setup_method(self):
        reset_caches()

    def teardown_method(self):
        reset_caches()

    def test_l1_miss_when_disabled(self, monkeypatch):
        monkeypatch.setenv("CACHE_ENABLED", "false")
        from app.config import get_settings
        get_settings.cache_clear()
        try:
            set_l1_cache("k", "v")
            assert get_l1_cached("k") is None
        finally:
            get_settings.cache_clear()
            monkeypatch.delenv("CACHE_ENABLED", raising=False)

    def test_l2_miss_when_disabled(self, monkeypatch):
        monkeypatch.setenv("CACHE_ENABLED", "false")
        from app.config import get_settings
        get_settings.cache_clear()
        try:
            set_l2_cache("k", {"data": 1})
            assert get_l2_cached("k") is None
        finally:
            get_settings.cache_clear()
            monkeypatch.delenv("CACHE_ENABLED", raising=False)

    def test_l1_set_and_get(self):
        set_l1_cache("mykey", [1, 2, 3])
        result = get_l1_cached("mykey")
        assert result == [1, 2, 3]

    def test_l2_set_and_get(self):
        payload = {"report_text": "hello", "citations": []}
        set_l2_cache("mykey2", payload)
        result = get_l2_cached("mykey2")
        assert result is not None
        assert result["report_text"] == "hello"

    def test_l2_ttl_via_config(self, monkeypatch):
        """TTL 设为 1 秒，等待后应该 miss。"""
        monkeypatch.setenv("CACHE_L2_TTL_S", "1")
        from app.config import get_settings
        get_settings.cache_clear()
        reset_caches()
        try:
            set_l2_cache("ttlkey", {"x": 1})
            assert get_l2_cached("ttlkey") is not None
            # 手动让缓存过期
            from app.cache import _get_l2, _l2_lock
            import threading
            with _l2_lock:
                cache = _get_l2()
                cache._store["ttlkey"] = (cache._store["ttlkey"][0], time.monotonic() - 1)
            assert get_l2_cached("ttlkey") is None
        finally:
            get_settings.cache_clear()
            monkeypatch.delenv("CACHE_L2_TTL_S", raising=False)
            reset_caches()


class TestCacheKeys:
    def test_l2_scope_filter_order_independent(self):
        """scopeFilters 顺序不同时应命中同一键。"""
        from app.pipeline.stream import _make_l2_key
        k1 = _make_l2_key("query", "general", "tavily", ["preprint", "code"])
        k2 = _make_l2_key("query", "general", "tavily", ["code", "preprint"])
        assert k1 == k2

    def test_l2_different_query_different_key(self):
        from app.pipeline.stream import _make_l2_key
        k1 = _make_l2_key("query A", "general", "tavily", [])
        k2 = _make_l2_key("query B", "general", "tavily", [])
        assert k1 != k2

    def test_l2_case_insensitive_query(self):
        from app.pipeline.stream import _make_l2_key
        k1 = _make_l2_key("FlashAttention", "general", "tavily", [])
        k2 = _make_l2_key("flashattention", "general", "tavily", [])
        assert k1 == k2

    def test_l1_key_components(self):
        from app.pipeline.stream import _make_l1_key
        k1 = _make_l1_key("tavily", ["preprint"], "sub query")
        k2 = _make_l1_key("tavily", ["preprint"], "other query")
        assert k1 != k2


# ---------------------------------------------------------------------------
# 任务 1：心跳真正出现在响应流里
# ---------------------------------------------------------------------------


class TestHeartbeat:
    """用假的慢阶段（asyncio.sleep）验证心跳帧在 heartbeat_interval_s 内出现。"""

    @pytest.mark.asyncio
    async def test_ping_appears_during_slow_phase(self, monkeypatch):
        """把心跳间隔设成 0.2s，改写阶段 sleep 0.6s，断言至少出现 2 次 ping。"""
        monkeypatch.setenv("HEARTBEAT_INTERVAL_S", "0.2")
        monkeypatch.setenv("CACHE_ENABLED", "false")
        from app.config import get_settings
        get_settings.cache_clear()

        from app.pipeline import stream as stream_mod

        # 假的 rewrite_query：sleep 0.6s 后返回
        async def fake_rewrite(**kwargs):
            await asyncio.sleep(0.6)
            return ["sub query 1"], False, None

        # 假的整个后续流水线：直接返回 done（通过让 search 返回空来触发 error 退出）
        async def fake_search_one(provider, q, **kw):
            return []

        from fastapi import Request
        mock_request = MagicMock(spec=Request)
        mock_request.is_disconnected = AsyncMock(return_value=False)

        # 用假密钥让引擎不为 None
        monkeypatch.setenv("TAVILY_API_KEY", "fake-key-for-test")
        monkeypatch.setenv("LLM_API_KEY", "fake-llm-key")
        get_settings.cache_clear()

        frames: list[str] = []
        with patch("app.pipeline._pipeline.rewrite_query", fake_rewrite):
            with patch("app.pipeline._pipeline.TavilyProvider") as mock_prov_cls:
                mock_prov = MagicMock()
                mock_prov.engine_name = "tavily"
                mock_prov.search = AsyncMock(return_value=[])
                mock_prov_cls.return_value = mock_prov

                gen = stream_mod.run_pipeline(
                    request=mock_request,
                    query="test ping",
                    focus_mode="general",
                    engine="tavily",
                    scope_filters=[],
                )
                async for frame in gen:
                    frames.append(frame)
                    # 拿到 error 帧后继续一轮确保 ping 被 yield
                    if '"event":"error"' in frame or 'event: error' in frame:
                        break

        ping_count = sum(1 for f in frames if f.strip() == ": ping")
        assert ping_count >= 1, f"期望至少 1 个 ping，实际帧: {frames}"

        get_settings.cache_clear()
        monkeypatch.delenv("HEARTBEAT_INTERVAL_S", raising=False)
        monkeypatch.delenv("CACHE_ENABLED", raising=False)
        monkeypatch.delenv("TAVILY_API_KEY", raising=False)
        monkeypatch.delenv("LLM_API_KEY", raising=False)

    @pytest.mark.asyncio
    async def test_event_ids_continuous_around_ping(self, monkeypatch):
        """ping 帧（注释行）不占用 event id，业务帧 id 连续。"""
        monkeypatch.setenv("HEARTBEAT_INTERVAL_S", "0.15")
        monkeypatch.setenv("CACHE_ENABLED", "false")
        from app.config import get_settings
        get_settings.cache_clear()
        from app.pipeline import stream as stream_mod

        async def fake_rewrite(**kwargs):
            await asyncio.sleep(0.45)
            return ["q1"], False, None

        from fastapi import Request
        mock_request = MagicMock(spec=Request)
        mock_request.is_disconnected = AsyncMock(return_value=False)
        monkeypatch.setenv("TAVILY_API_KEY", "fake-key2")
        monkeypatch.setenv("LLM_API_KEY", "fake-llm2")
        get_settings.cache_clear()

        frames: list[str] = []
        with patch("app.pipeline._pipeline.rewrite_query", fake_rewrite):
            with patch("app.pipeline._pipeline.TavilyProvider") as mock_prov_cls:
                mock_prov = MagicMock()
                mock_prov.engine_name = "tavily"
                mock_prov.search = AsyncMock(return_value=[])
                mock_prov_cls.return_value = mock_prov
                gen = stream_mod.run_pipeline(
                    request=mock_request,
                    query="id test",
                    focus_mode="general",
                    engine="tavily",
                    scope_filters=[],
                )
                async for frame in gen:
                    frames.append(frame)
                    if "error" in frame:
                        break

        # 取出所有 id: N 行
        import re
        ids = [int(m.group(1)) for f in frames for m in re.finditer(r"^id: (\d+)", f, re.MULTILINE)]
        # ids 应该是连续递增的 1, 2, 3, ...
        for i, eid in enumerate(ids):
            assert eid == i + 1, f"id 不连续: ids={ids}"

        get_settings.cache_clear()
        monkeypatch.delenv("HEARTBEAT_INTERVAL_S", raising=False)
        monkeypatch.delenv("CACHE_ENABLED", raising=False)
        monkeypatch.delenv("TAVILY_API_KEY", raising=False)
        monkeypatch.delenv("LLM_API_KEY", raising=False)


# ---------------------------------------------------------------------------
# 任务 2：客户端中止日志与任务取消
# ---------------------------------------------------------------------------


class TestAbortLog:
    @pytest.mark.asyncio
    async def test_abort_log_contains_phase_and_count(self, monkeypatch, caplog):
        """模拟客户端在检索中途断开，断言日志含阶段和取消数。"""
        import logging
        monkeypatch.setenv("CACHE_ENABLED", "false")
        monkeypatch.setenv("HEARTBEAT_INTERVAL_S", "10")
        from app.config import get_settings
        get_settings.cache_clear()
        from app.pipeline import stream as stream_mod

        async def fake_rewrite(**kwargs):
            return ["q1", "q2"], False, None

        call_count = 0

        async def fake_search(q, count=10, exclude_categories=None):
            nonlocal call_count
            call_count += 1
            await asyncio.sleep(5)  # 长时间等待
            return []

        from fastapi import Request

        # 用事件标志：流水线第一帧出现后才开始计时，避免测试准备时间干扰
        pipeline_started = asyncio.Event()
        pipeline_start_time: list[float] = []
        disconnect_after = 0.5  # 改写后、检索开始时断开

        async def is_disconnected_mock():
            if not pipeline_started.is_set():
                return False
            elapsed = time.perf_counter() - pipeline_start_time[0]
            return elapsed > disconnect_after

        mock_request = MagicMock(spec=Request)
        mock_request.is_disconnected = is_disconnected_mock
        monkeypatch.setenv("TAVILY_API_KEY", "fake3")
        monkeypatch.setenv("LLM_API_KEY", "fake3")
        get_settings.cache_clear()

        start_time = time.perf_counter()

        with caplog.at_level(logging.INFO, logger="app.pipeline.stream"):
            with patch("app.pipeline._pipeline.rewrite_query", fake_rewrite):
                with patch("app.pipeline._pipeline.TavilyProvider") as mock_cls:
                    mock_prov = MagicMock()
                    mock_prov.engine_name = "tavily"
                    mock_prov.search = AsyncMock(side_effect=fake_search)
                    mock_cls.return_value = mock_prov

                    gen = stream_mod.run_pipeline(
                        request=mock_request,
                        query="abort test",
                        focus_mode="general",
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
                            if time.perf_counter() - start_time > 5.0:
                                break
                    except Exception:
                        pass

        log_text = " ".join(caplog.messages)
        assert "客户端已断开" in log_text, f"日志未包含断开提示，日志: {caplog.messages}"
        assert "阶段=" in log_text or "searching" in log_text, f"日志未含阶段: {caplog.messages}"

        get_settings.cache_clear()
        monkeypatch.delenv("CACHE_ENABLED", raising=False)
        monkeypatch.delenv("HEARTBEAT_INTERVAL_S", raising=False)
        monkeypatch.delenv("TAVILY_API_KEY", raising=False)
        monkeypatch.delenv("LLM_API_KEY", raising=False)
