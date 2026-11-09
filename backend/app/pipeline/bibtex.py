"""BibTeX 生成工具（F13，仅 preprint 类信源）。

必需字段策略（决策 D4：缺任何一个必需字段就返回 None）：
  - title：来自 RawSource.title，不为空字符串
  - year：从 published_at（ISO 8601）提取，或从 arXiv ID 前缀推断
  - arxiv_id：从 URL 提取（仅 arxiv.org 域名）

可选字段：
  - doi：从 URL 或内容里识别（暂不实现，URL 精确匹配 doi.org）

不请求额外页面，只用已有元数据（避免引入新的 I/O 依赖）。
"""
from __future__ import annotations

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.pipeline.providers import RawSource

# arXiv URL 匹配：abs/、pdf/、html/ 路径下的 ID
_ARXIV_ID_RE = re.compile(
    r"arxiv\.org/(?:abs|pdf|html|e-print)/([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)",
    re.IGNORECASE,
)

# DOI URL 匹配
_DOI_RE = re.compile(
    r"(?:doi\.org/|/doi/)([^?#\s]+)",
    re.IGNORECASE,
)

# 年份从 published_at（ISO 8601 或 YYYY 前缀）提取
_YEAR_RE = re.compile(r"^(\d{4})")

# BibTeX 特殊字符需要转义的字符集（标题用 {} 括起来保护大小写，故只需转义特殊符号）
_BIBTEX_ESCAPE = str.maketrans({
    "&": r"\&",
    "%": r"\%",
    "_": r"\_",
    "#": r"\#",
    "$": r"\$",
})


def _escape_bibtex(text: str) -> str:
    """对 BibTeX 标题字段做最小转义（&/%/_/#/$）。"""
    return text.translate(_BIBTEX_ESCAPE)


def _extract_arxiv_id(url: str) -> str | None:
    m = _ARXIV_ID_RE.search(url)
    return m.group(1) if m else None


def _extract_doi(url: str) -> str | None:
    m = _DOI_RE.search(url)
    return m.group(1) if m else None


def _extract_year(published_at: str | None, arxiv_id: str | None) -> str | None:
    """从 published_at 或 arXiv ID 前缀推断年份。"""
    if published_at:
        m = _YEAR_RE.match(published_at.strip())
        if m:
            year = m.group(1)
            if 1900 <= int(year) <= 2100:
                return year
    if arxiv_id:
        # arXiv ID 格式 YYMM.xxxxx，20xx 系列
        prefix = arxiv_id[:4]
        if re.match(r"^\d{4}$", prefix):
            yy = int(prefix[:2])
            year = 2000 + yy if yy <= 99 else None
            if year and 2007 <= year <= 2100:
                return str(year)
    return None


def _make_entry_key(title: str, year: str, arxiv_id: str | None) -> str:
    """生成稳定的 entry key：ArXiv_YYMM_XXXXX 或 arxiv_YEAR_首词。"""
    if arxiv_id:
        # 去掉版本号后缀（v1, v2）
        base_id = re.sub(r"v\d+$", "", arxiv_id).replace(".", "_")
        return f"arxiv_{base_id}"
    # fallback：年份 + 标题第一个有意义的词
    words = re.findall(r"[a-zA-Z]+", title)
    first_word = words[0].lower() if words else "paper"
    return f"{year}_{first_word}"


def generate_bibtex(src: "RawSource") -> str | None:
    """为 preprint 类信源生成 BibTeX 字符串。

    必需字段缺失时返回 None（对应前端禁用复制按钮）。
    """
    # 只为 preprint 生成
    if src.category != "preprint":
        return None

    title = (src.title or "").strip()
    if not title:
        return None

    arxiv_id = _extract_arxiv_id(src.url)
    doi = _extract_doi(src.url) if not arxiv_id else None
    year = _extract_year(src.published_at, arxiv_id)

    # 必需字段检查：title + year（+ 至少有 arxiv_id 或 doi，否则来源不明）
    if not year:
        return None
    if not arxiv_id and not doi:
        return None

    key = _make_entry_key(title, year, arxiv_id)
    escaped_title = _escape_bibtex(title)

    if arxiv_id:
        # arXiv 条目用 @misc
        entry_type = "misc"
        fields = [
            f"  title = {{{{{escaped_title}}}}}",
            f"  year = {{{year}}}",
            f"  eprint = {{{arxiv_id}}}",
            "  archivePrefix = {arXiv}",
        ]
    else:
        # DOI 条目用 @article
        entry_type = "article"
        fields = [
            f"  title = {{{{{escaped_title}}}}}",
            f"  year = {{{year}}}",
            f"  doi = {{{doi}}}",
        ]

    body = ",\n".join(fields)
    return f"@{entry_type}{{{key},\n{body}\n}}"
