"""单元测试：LocalRuleClassifier 分类器。"""

import pytest
from app.pipeline.classifier import classify_source, get_authority


class TestClassifySource:
    def test_arxiv(self):
        cat, rule = classify_source("arxiv.org")
        assert cat == "preprint"
        assert "arxiv.org" in rule

    def test_arxiv_subdomain(self):
        cat, _ = classify_source("ar5iv.labs.arxiv.org")
        assert cat == "preprint"

    def test_alphaxiv_mirror(self):
        cat, _ = classify_source("alphaxiv.org")
        assert cat == "preprint"

    def test_github(self):
        cat, rule = classify_source("github.com")
        assert cat == "code"

    def test_github_subdomain(self):
        # raw.githubusercontent.com
        cat, _ = classify_source("raw.githubusercontent.com")
        assert cat == "code"

    def test_rfc_editor(self):
        cat, _ = classify_source("rfc-editor.org")
        assert cat == "spec"

    def test_w3c(self):
        cat, _ = classify_source("w3.org")
        assert cat == "spec"

    def test_readthedocs(self):
        cat, _ = classify_source("vllm.readthedocs.io")
        assert cat == "docs"

    def test_docs_prefix(self):
        cat, rule = classify_source("docs.vllm.ai")
        assert cat == "docs"
        assert "host-prefix" in rule

    def test_docs_python(self):
        cat, _ = classify_source("docs.python.org")
        assert cat == "docs"

    def test_blog_fallback(self):
        cat, rule = classify_source("medium.com")
        assert cat == "blog"
        assert rule == "default"

    def test_unknown_domain(self):
        cat, _ = classify_source("some-random-blog.io")
        assert cat == "blog"

    def test_neurips_subdomain(self):
        cat, _ = classify_source("proceedings.neurips.cc")
        assert cat == "preprint"


class TestGetAuthority:
    def test_spec_authority(self):
        assert get_authority("w3.org") == pytest.approx(0.9)

    def test_docs_authority(self):
        assert get_authority("docs.vllm.ai") == pytest.approx(0.85)

    def test_code_authority(self):
        assert get_authority("github.com") == pytest.approx(0.7)

    def test_preprint_authority(self):
        assert get_authority("arxiv.org") == pytest.approx(0.8)

    def test_blog_authority(self):
        assert get_authority("random-blog.com") == pytest.approx(0.5)
