"""SearchProvider 基类与工具函数。

每个 Provider 实现 search(query, count, exclude_categories, need_passage) -> list[RawSource]。
RawSource 是 SourceCard 的精简子集，只含 raw 批次需要的字段。
URL 归一化、passage 清洗、stable id 等工具函数也在这里。
"""

from __future__ import annotations

import hashlib
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

# ---------------------------------------------------------------------------
# 数据结构
# ---------------------------------------------------------------------------

@dataclass
class RawSource:
    """raw 批次下发的精简 SourceCard（§4.1 raw 含 = 是 的字段）。"""
    id: str              # src_ + sha256(归一化URL)[:12]
    title: str
    url: str             # 展示 URL：去掉 # 片段，其余保留
    domain: str          # 小写 host，去掉 www. 前缀
    favicon_url: str | None
    engine: str          # tavily / deepseek
    category: str        # preprint/code/spec/docs/blog
    category_source: str = "rule"
    published_at: str | None = None
    confidence: float | None = None

    # 暂存原始分数供 ranker 使用，不下发给前端
    _raw_score: float | None = field(default=None, repr=False, compare=False)
    _rerank_score: float | None = field(default=None, repr=False, compare=False)
    _authority_signal: int | None = field(default=None, repr=False, compare=False)
    _norm_url: str = field(default="", repr=False, compare=False)  # 归一化 URL，去重键
    _matched_queries: list[int] = field(default_factory=list, repr=False, compare=False)
    _summary: str | None = field(default=None, repr=False, compare=False)  # passage 原料
    _content: str | None = field(default=None, repr=False, compare=False)  # Tavily content


@dataclass
class FullSource(RawSource):
    """ranked 批次完整 SourceCard 字段（在 RawSource 基础上增加）。"""
    index: int | None = None
    category_rule: str = "default"
    passage: str | None = None
    passage_truncated: bool | None = None
    scores: dict[str, Any] | None = None
    engine_signals: dict[str, Any] | None = None
    matched_queries: list[int] = field(default_factory=list)
    bibtex: str | None = None
    pdf_url: str | None = None


# ---------------------------------------------------------------------------
# 基类
# ---------------------------------------------------------------------------

class SearchProvider(ABC):
    """搜索引擎抽象基类。"""

    @abstractmethod
    async def search(
        self,
        query: str,
        count: int = 10,
        exclude_categories: list[str] | None = None,
        need_passage: bool = True,
    ) -> list[RawSource]:
        """执行一次搜索，返回 RawSource 列表。超时由调用方通过 asyncio.wait_for 控制。"""
        ...

    @property
    @abstractmethod
    def engine_name(self) -> str:
        """引擎标识，与 §4.5 域名规则表一致：tavily / deepseek。"""
        ...


# ---------------------------------------------------------------------------
# URL 归一化与稳定 id
# ---------------------------------------------------------------------------

def normalize_url(url: str) -> str:
    """归一化 URL，用于去重和计算稳定 id（§4.2）。

    规则：
    1. scheme、host 转小写；host 去掉 www. 前缀
    2. 端口：http:80、https:443 省略，其余保留
    3. path：空则视为 /；长度 > 1 时去掉末尾 /
    4. query：丢弃键以 utm_ 开头的参数，其余按原样保留
    5. 去掉 # 片段
    """
    try:
        parsed = urlparse(url)
    except Exception:
        return url

    scheme = parsed.scheme.lower()
    host = parsed.netloc.lower()

    # 分离端口
    if ":" in host:
        hostname, port_str = host.rsplit(":", 1)
        try:
            port = int(port_str)
        except ValueError:
            port = None
    else:
        hostname, port = host, None

    # 去 www. 前缀
    if hostname.startswith("www."):
        hostname = hostname[4:]

    # 省略默认端口
    if (scheme == "http" and port == 80) or (scheme == "https" and port == 443):
        netloc = hostname
    elif port:
        netloc = f"{hostname}:{port}"
    else:
        netloc = hostname

    # path
    path = parsed.path or "/"
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/")

    # query：去掉 utm_ 参数
    qs = parse_qs(parsed.query, keep_blank_values=True)
    filtered_qs = {k: v for k, v in qs.items() if not k.startswith("utm_")}
    query_str = urlencode(filtered_qs, doseq=True) if filtered_qs else ""

    return urlunparse((scheme, netloc, path, "", query_str, ""))


def stable_id(url: str) -> str:
    """生成稳定 id = 'src_' + sha256(归一化URL)[:12]（§4.2）。"""
    norm = normalize_url(url)
    digest = hashlib.sha256(norm.encode()).hexdigest()
    return f"src_{digest[:12]}"


def display_url(url: str) -> str:
    """展示 URL：只去掉 # 片段，其余保留（含 www.、query）。"""
    idx = url.find("#")
    return url[:idx] if idx >= 0 else url


def extract_domain(url: str) -> str:
    """小写 host，去掉 www. 前缀，保留子域（§4.1）。"""
    try:
        host = urlparse(url).netloc.lower()
        if ":" in host:
            host = host.rsplit(":", 1)[0]
        if host.startswith("www."):
            host = host[4:]
        return host
    except Exception:
        return ""


# ---------------------------------------------------------------------------
# passage 清洗（§4.4）
# ---------------------------------------------------------------------------

_NAV_LINE_RE = re.compile(
    r"^\s*\[(?:Skip to content|Back to [^\]]+)\]\([^)]+\)\s*$",
    re.MULTILINE,
)
_SINGLE_LINK_LINE_RE = re.compile(r"^\s*\[[^\]]+\]\([^)]+\)\s*$", re.MULTILINE)
_MD_IMAGE_RE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_MD_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]+\)")
_MULTI_NEWLINE_RE = re.compile(r"\n{3,}")
_SENT_BOUNDARY_RE = re.compile(r"[.!?。！？]\s*$")

MAX_PASSAGE_CHARS = 1500
TRUNC_SEARCH_WINDOW = 200


def clean_passage(text: str | None) -> tuple[str | None, bool]:
    """清洗原文片段，返回 (cleaned, truncated)。

    清洗规则（§4.4）：
    1. 去掉开头的 '2000 character limit reached' 行
    2. 去掉整行是导航链接的行
    3. 删 Markdown 图片，链接还原为文本
    4. 连续 3+ 换行压成 2 个，去首尾空白
    5. 长度上限 1500 字符（码点）
    """
    if not text:
        return None, False

    # 规则 1
    if text.startswith("2000 character limit reached"):
        nl = text.find("\n")
        text = text[nl + 1:] if nl >= 0 else ""

    # 规则 2
    text = _NAV_LINE_RE.sub("", text)
    text = _SINGLE_LINK_LINE_RE.sub("", text)

    # 规则 3
    text = _MD_IMAGE_RE.sub("", text)
    text = _MD_LINK_RE.sub(r"\1", text)

    # 规则 4
    text = _MULTI_NEWLINE_RE.sub("\n\n", text)
    text = text.strip()

    if not text:
        return None, False

    # 规则 5：长度上限（码点数）
    chars = list(text)
    if len(chars) <= MAX_PASSAGE_CHARS:
        return text, False

    # 尝试在句末标点或换行处断
    window_start = MAX_PASSAGE_CHARS - TRUNC_SEARCH_WINDOW
    best_cut = MAX_PASSAGE_CHARS
    for i in range(MAX_PASSAGE_CHARS - 1, window_start - 1, -1):
        c = chars[i]
        if c in ".!?。！？\n":
            best_cut = i + 1
            break

    truncated = "".join(chars[:best_cut]).rstrip()
    return truncated, True
