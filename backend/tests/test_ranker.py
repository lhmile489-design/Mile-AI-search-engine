"""单元测试：重排模块。"""

import pytest
from app.pipeline.providers import RawSource
from app.pipeline.ranker import compute_freshness, compute_score, rank_sources


def _make_raw(
    url: str = "https://github.com/repo",
    engine: str = "tavily",
    raw_score: float | None = 0.8,
    rerank_score: float | None = None,
    published_at: str | None = "2025-01-01T00:00:00Z",
    query_index: int = 0,
) -> RawSource:
    from app.pipeline.providers import stable_id, extract_domain, display_url
    from app.pipeline.classifier import classify_source
    domain = extract_domain(url)
    cat, _ = classify_source(domain)
    src = RawSource(
        id=stable_id(url),
        title="Test",
        url=display_url(url),
        domain=domain,
        favicon_url=None,
        engine=engine,
        category=cat,
        category_source="rule",
        published_at=published_at,
        _raw_score=raw_score,
        _rerank_score=rerank_score,
        _matched_queries=[query_index],
    )
    return src


class TestComputeFreshness:
    def test_recent_date_high_freshness(self):
        f = compute_freshness("2025-01-01T00:00:00Z")
        assert f is not None
        assert 0 < f <= 1.0

    def test_old_date_low_freshness(self):
        f = compute_freshness("2010-01-01T00:00:00Z")
        assert f is not None
        assert f < 0.2

    def test_none_returns_none(self):
        assert compute_freshness(None) is None

    def test_future_returns_1(self):
        f = compute_freshness("2099-01-01T00:00:00Z")
        assert f == pytest.approx(1.0)


class TestComputeScore:
    def test_tavily_web_mode(self):
        final, scores = compute_score(
            engine="tavily",
            raw_score=0.8,
            rerank_score=None,
            authority=0.7,
            freshness=0.5,
            focus_mode="web",
        )
        # web: 0.5*0.8 + 0.35*0.7 + 0.15*0.5 = 0.4 + 0.245 + 0.075 = 0.72
        assert final == pytest.approx(0.72, abs=1e-3)
        assert scores["relevance"] == 0.8
        assert scores["authority"] == 0.7

    def test_tavily_no_freshness_redistributes_weight(self):
        final, scores = compute_score(
            engine="tavily",
            raw_score=0.8,
            rerank_score=None,
            authority=0.7,
            freshness=None,
            focus_mode="web",
        )
        # freshness=None 时权重重分，weights 之和应约为 1
        w = scores["weights"]
        assert abs(w["relevance"] + w["authority"] + w["freshness"]) == pytest.approx(1.0, abs=1e-3) or w["freshness"] == 0.0
        assert scores["freshness"] is None

    def test_deepseek_score_is_normalized(self):
        final, scores = compute_score(
            engine="deepseek",
            raw_score=None,
            rerank_score=2.1,
            authority=0.8,
            freshness=0.6,
            focus_mode="web",
        )
        # §5.3: final = clamp(2.1/3, 0, 1) = 0.7
        assert final == pytest.approx(0.7, abs=1e-3)
        assert scores["weights"]["relevance"] == 1.0
        assert scores["weights"]["authority"] == 0.0


class TestRankSources:
    def test_deduplication(self):
        url = "https://github.com/repo"
        src1 = _make_raw(url=url + "#1", raw_score=0.9, query_index=0)
        src2 = _make_raw(url=url + "#2", raw_score=0.7, query_index=1)
        ranked = rank_sources([src1, src2], focus_mode="web", scope_filters=[], top_k=10)
        # 归一化后同一 URL，应只保留 1 条
        assert len(ranked) == 1

    def test_index_starts_at_1(self):
        sources = [
            _make_raw(url="https://github.com/a", raw_score=0.9),
            _make_raw(url="https://arxiv.org/b",  raw_score=0.8),
        ]
        ranked = rank_sources(sources, focus_mode="web", scope_filters=[], top_k=10)
        indices = [s.index for s in ranked]
        assert 1 in indices
        assert 2 in indices

    def test_top_k_limits_results(self):
        sources = [_make_raw(url=f"https://example{i}.com/page", raw_score=0.5) for i in range(20)]
        ranked = rank_sources(sources, focus_mode="web", scope_filters=[], top_k=5)
        assert len(ranked) == 5

    def test_scope_filter_removes_out_of_scope(self):
        sources = [
            _make_raw(url="https://arxiv.org/abs/1234", raw_score=0.9),  # preprint
            _make_raw(url="https://github.com/repo",    raw_score=0.8),  # code
        ]
        # 只允许 code
        ranked = rank_sources(sources, focus_mode="web", scope_filters=["code"], top_k=10)
        for s in ranked:
            assert s.category == "code"

    def test_sorted_by_score_descending(self):
        sources = [
            _make_raw(url="https://example1.com/a", raw_score=0.3),
            _make_raw(url="https://example2.com/b", raw_score=0.9),
            _make_raw(url="https://example3.com/c", raw_score=0.6),
        ]
        ranked = rank_sources(sources, focus_mode="web", scope_filters=[], top_k=10)
        finals = [s.scores["final"] for s in ranked]
        assert finals == sorted(finals, reverse=True)
