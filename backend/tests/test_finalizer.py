"""单元测试：引用解析与高亮定位。"""

import pytest
from app.pipeline.finalizer import parse_citations, compute_consensus, split_sentences, _find_highlight
from app.pipeline.providers import FullSource


def _make_source(index: int, domain: str, passage: str | None = None) -> FullSource:
    return FullSource(
        id=f"src_test{index:03d}",
        title=f"Test Source {index}",
        url=f"https://{domain}/page",
        domain=domain,
        favicon_url=None,
        engine="tavily",
        category="blog",
        category_source="rule",
        index=index,
        category_rule="default",
        passage=passage,
        passage_truncated=False if passage else None,
        scores=None,
        engine_signals=None,
        matched_queries=[0],
    )


class TestSplitSentences:
    def test_basic(self):
        sents = split_sentences("Hello world. This is a test.")
        assert len(sents) >= 2

    def test_chinese_punct(self):
        sents = split_sentences("这是第一句。这是第二句！")
        assert len(sents) >= 2

    def test_empty(self):
        assert split_sentences("") == []

    def test_no_punct(self):
        # 无标点当作一句
        sents = split_sentences("no punctuation here")
        assert len(sents) == 1


class TestParseCitations:
    def test_basic_citation(self):
        sources = [_make_source(1, "github.com", "FP8 kernel throughput benchmark results.")]
        report = "FlashAttention-3 achieves high throughput [1]."
        cits, hallucinated = parse_citations(report, sources)
        assert len(cits) == 1
        assert cits[0]["index"] == 1
        assert hallucinated == []

    def test_out_of_range_hallucination(self):
        sources = [_make_source(1, "github.com")]
        report = "Some claim [1] and another claim [99]."
        cits, hallucinated = parse_citations(report, sources)
        valid = [c for c in cits if c["index"] == 1]
        assert len(valid) == 1
        assert 99 in hallucinated

    def test_no_citations(self):
        sources = [_make_source(1, "github.com")]
        report = "No references here."
        cits, hallucinated = parse_citations(report, sources)
        assert cits == []
        assert hallucinated == []

    def test_utf16_offsets_ascii(self):
        """ASCII 文本 UTF-16 偏移等于 Python 索引。"""
        sources = [_make_source(1, "github.com", "FlashAttention FP8 benchmark.")]
        report = "See result [1] here."
        cits, _ = parse_citations(report, sources)
        assert len(cits) == 1
        # [1] 在 "See result " (11 chars) 之后
        c = cits[0]
        assert c["markerStart"] == 11
        assert c["markerEnd"] == 14  # [1] = 3 chars

    def test_utf16_offsets_cjk(self):
        """CJK 字符 UTF-16 每个字符 1 个码元（BMP 范围）。"""
        sources = [_make_source(1, "arxiv.org", "相关研究表明性能提升。")]
        report = "研究结果显示 [1] 性能提升。"
        cits, _ = parse_citations(report, sources)
        assert len(cits) == 1
        c = cits[0]
        # "研究结果显示 " = 7 chars = 7 UTF-16 code units (all BMP)
        assert c["markerStart"] == 7
        assert c["markerEnd"] == 10  # [1]


class TestComputeConsensus:
    def test_no_citations_returns_none(self):
        sources = [_make_source(1, "github.com")]
        result = compute_consensus("No refs.", [], sources)
        assert result is None

    def test_single_domain_zero_support(self):
        sources = [_make_source(1, "github.com"), _make_source(2, "github.com")]
        report = "Result [1] confirmed [2]."
        cits, _ = parse_citations(report, sources)
        result = compute_consensus(report, cits, sources)
        # 两个引用同一域名，supported = 0
        assert result is not None
        assert result["supportedSentences"] == 0
        assert result["score"] == pytest.approx(0.0)

    def test_two_domains_full_support(self):
        sources = [
            _make_source(1, "arxiv.org"),
            _make_source(2, "github.com"),
        ]
        report = "Result confirmed [1] [2]."
        cits, _ = parse_citations(report, sources)
        result = compute_consensus(report, cits, sources)
        assert result is not None
        assert result["supportedSentences"] >= 1
        assert result["score"] > 0


class TestFindHighlight:
    def test_finds_best_match(self):
        query = "FlashAttention FP8 throughput hopper"
        passage = "This is irrelevant text.\nFlashAttention-3 FP8 throughput on Hopper GPU is high.\nAnother sentence."
        result = _find_highlight(query, passage)
        assert result is not None
        assert result["score"] > 0.1

    def test_below_threshold_returns_none(self):
        query = "xyzzyx completely unrelated"
        passage = "FlashAttention FP8 performance."
        result = _find_highlight(query, passage, threshold=0.5)
        # 应该找不到足够相似的
        assert result is None or result["score"] < 0.5
