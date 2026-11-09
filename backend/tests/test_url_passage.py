"""单元测试：URL 归一化、stable_id、passage 清洗。"""

import pytest
from app.pipeline.providers import normalize_url, stable_id, display_url, extract_domain, clean_passage


class TestNormalizeUrl:
    def test_removes_fragment(self):
        assert normalize_url("https://arxiv.org/abs/2407.08608#2") == "https://arxiv.org/abs/2407.08608"

    def test_removes_multiple_fragments(self):
        assert normalize_url("https://pypi.org/project/pi-flash-attn/#1#1") == "https://pypi.org/project/pi-flash-attn"

    def test_strips_www(self):
        n = normalize_url("https://www.github.com/repo")
        assert "www." not in n

    def test_strips_default_port_http(self):
        assert normalize_url("http://example.com:80/path") == "http://example.com/path"

    def test_strips_default_port_https(self):
        assert normalize_url("https://example.com:443/path") == "https://example.com/path"

    def test_keeps_nondefault_port(self):
        n = normalize_url("https://example.com:8080/path")
        assert "8080" in n

    def test_strips_trailing_slash(self):
        assert normalize_url("https://github.com/repo/") == "https://github.com/repo"

    def test_removes_utm_params(self):
        n = normalize_url("https://blog.example.com/post?utm_source=twitter&id=1")
        assert "utm_source" not in n
        assert "id=1" in n

    def test_lowercases_host(self):
        n = normalize_url("https://GitHub.COM/repo")
        assert "github.com" in n

    def test_path_empty_becomes_slash(self):
        n = normalize_url("https://example.com")
        assert n.endswith("example.com/") or n == "https://example.com"

    def test_same_url_different_fragments_same_norm(self):
        a = normalize_url("https://docs.python.org/3/library/os#os.path")
        b = normalize_url("https://docs.python.org/3/library/os#os.getcwd")
        assert a == b


class TestStableId:
    def test_prefix(self):
        sid = stable_id("https://github.com/repo")
        assert sid.startswith("src_")

    def test_length(self):
        sid = stable_id("https://github.com/repo")
        assert len(sid) == len("src_") + 12

    def test_same_url_same_id(self):
        a = stable_id("https://arxiv.org/abs/1234#1")
        b = stable_id("https://arxiv.org/abs/1234#2")
        assert a == b  # 片段去掉后归一化相同

    def test_different_urls_different_id(self):
        a = stable_id("https://github.com/repo1")
        b = stable_id("https://github.com/repo2")
        assert a != b


class TestDisplayUrl:
    def test_removes_fragment(self):
        assert display_url("https://example.com/page#section") == "https://example.com/page"

    def test_no_fragment(self):
        assert display_url("https://example.com/page") == "https://example.com/page"


class TestExtractDomain:
    def test_strips_www(self):
        assert extract_domain("https://www.github.com/repo") == "github.com"

    def test_keeps_subdomain(self):
        assert extract_domain("https://docs.vllm.ai/page") == "docs.vllm.ai"

    def test_lowercase(self):
        assert extract_domain("https://ArXiv.Org/abs/1234") == "arxiv.org"


class TestCleanPassage:
    def test_removes_2000_char_limit_line(self):
        text = "2000 character limit reached\nActual content here."
        cleaned, _ = clean_passage(text)
        assert cleaned is not None
        assert "2000 character limit reached" not in cleaned
        assert "Actual content" in cleaned

    def test_removes_nav_links(self):
        text = "[Skip to content](https://example.com)\nReal content."
        cleaned, _ = clean_passage(text)
        assert cleaned is not None
        assert "Skip to content" not in cleaned

    def test_removes_md_images(self):
        text = "Before ![alt](url) after."
        cleaned, _ = clean_passage(text)
        assert cleaned is not None
        assert "![" not in cleaned

    def test_converts_md_links(self):
        text = "See [this article](https://example.com) for more."
        cleaned, _ = clean_passage(text)
        assert cleaned is not None
        assert "this article" in cleaned
        assert "https://example.com" not in cleaned

    def test_compresses_newlines(self):
        text = "Line1\n\n\n\nLine2"
        cleaned, _ = clean_passage(text)
        assert cleaned is not None
        assert "\n\n\n" not in cleaned

    def test_truncation_at_1500(self):
        text = "A" * 2000
        cleaned, truncated = clean_passage(text)
        assert truncated is True
        assert cleaned is not None
        assert len(cleaned) <= 1500

    def test_none_input(self):
        cleaned, trunc = clean_passage(None)
        assert cleaned is None
        assert trunc is False

    def test_empty_string(self):
        cleaned, trunc = clean_passage("")
        assert cleaned is None

    def test_short_text_not_truncated(self):
        text = "Short passage."
        cleaned, truncated = clean_passage(text)
        assert cleaned == "Short passage."
        assert truncated is False
