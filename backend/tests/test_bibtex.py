"""F13 BibTeX 生成单测。

测试必需字段组合、缺字段返回 None、特殊字符转义、条目 key 稳定性。
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class FakeSrc:
    """最小化 RawSource 替代，只含 bibtex.generate_bibtex 需要的字段。"""
    category: str
    title: str
    url: str
    published_at: str | None = None


class TestBibTeX:
    """generate_bibtex 单元测试。"""

    def test_arxiv_with_published_at(self):
        """arXiv URL + published_at，生成合法 @misc 条目。"""
        from app.pipeline.bibtex import generate_bibtex

        src = FakeSrc(
            category="preprint",
            title="Attention Is All You Need",
            url="https://arxiv.org/abs/1706.03762",
            published_at="2017-06-12",
        )
        result = generate_bibtex(src)
        assert result is not None
        assert "@misc{arxiv_1706_03762," in result
        assert "title = {{Attention Is All You Need}}" in result
        assert "year = {2017}" in result
        assert "eprint = {1706.03762}" in result
        assert "archivePrefix = {arXiv}" in result

    def test_arxiv_no_published_at_infer_year(self):
        """无 published_at 时从 arXiv ID 前缀推断年份。"""
        from app.pipeline.bibtex import generate_bibtex

        src = FakeSrc(
            category="preprint",
            title="FlashAttention",
            url="https://arxiv.org/pdf/2205.14135v2",
        )
        result = generate_bibtex(src)
        assert result is not None
        assert "year = {2022}" in result
        assert "eprint = {2205.14135v2}" in result

    def test_non_preprint_returns_none(self):
        """非 preprint 类信源返回 None。"""
        from app.pipeline.bibtex import generate_bibtex

        for cat in ["code", "spec", "docs", "blog", "web"]:
            src = FakeSrc(
                category=cat,
                title="Some Project",
                url="https://arxiv.org/abs/2301.00001",
                published_at="2023-01-01",
            )
            assert generate_bibtex(src) is None, f"category={cat} 应返回 None"

    def test_missing_year_returns_none(self):
        """arXiv ID 无法推断年份时返回 None（极旧格式 ID）。"""
        from app.pipeline.bibtex import generate_bibtex

        src = FakeSrc(
            category="preprint",
            title="Old Format Paper",
            url="https://arxiv.org/abs/hep-th/9901001",  # 旧格式无年份前缀
        )
        result = generate_bibtex(src)
        # 旧格式 ID 无法匹配正则，无 arxiv_id，且无 doi，返回 None
        assert result is None

    def test_no_arxiv_no_doi_returns_none(self):
        """非 arXiv URL 且无 DOI，返回 None。"""
        from app.pipeline.bibtex import generate_bibtex

        src = FakeSrc(
            category="preprint",
            title="OpenReview Paper",
            url="https://openreview.net/forum?id=abc123",
            published_at="2023-09-01",
        )
        assert generate_bibtex(src) is None

    def test_title_with_special_chars(self):
        """标题含 BibTeX 特殊字符（&, %, _, #），必须正确转义。"""
        from app.pipeline.bibtex import generate_bibtex

        src = FakeSrc(
            category="preprint",
            title="Paper & Study: 50% Gain_Test #1",
            url="https://arxiv.org/abs/2301.00001",
            published_at="2023-01-01",
        )
        result = generate_bibtex(src)
        assert result is not None
        assert r"\&" in result
        assert r"\%" in result
        assert r"\_" in result
        assert r"\#" in result

    def test_entry_key_stable(self):
        """相同输入生成相同的 entry key（幂等性）。"""
        from app.pipeline.bibtex import generate_bibtex

        src = FakeSrc(
            category="preprint",
            title="Consistent Key Paper",
            url="https://arxiv.org/abs/2312.12345",
            published_at="2023-12-01",
        )
        key1 = generate_bibtex(src)
        key2 = generate_bibtex(src)
        assert key1 == key2
        assert key1 is not None
        assert "arxiv_2312_12345" in key1

    def test_doi_url(self):
        """doi.org URL 生成 @article 条目。"""
        from app.pipeline.bibtex import generate_bibtex

        src = FakeSrc(
            category="preprint",
            title="Nature Paper",
            url="https://doi.org/10.1038/s41586-023-06704-9",
            published_at="2023-11-01",
        )
        result = generate_bibtex(src)
        assert result is not None
        assert "@article{" in result
        assert "doi = {10.1038/s41586-023-06704-9}" in result
        assert "year = {2023}" in result
