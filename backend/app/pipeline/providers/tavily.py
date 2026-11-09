"""Tavily 搜索引擎 Provider。

依据：接口设计 §4.3（publishedAt）、§4.4（passage）、M0 实测。
"""

from __future__ import annotations

import email.utils
import logging
from datetime import timezone
from typing import Any

import httpx

from app.pipeline.providers import (
    RawSource,
    SearchProvider,
    clean_passage,
    display_url,
    extract_domain,
    stable_id,
)
from app.pipeline.classifier import classify_source

logger = logging.getLogger(__name__)

# §4.5 各类别的域名列表，用于 Tavily exclude_domains
CATEGORY_DOMAINS: dict[str, list[str]] = {
    "preprint": [
        "arxiv.org", "alphaxiv.org", "ar5iv.labs.arxiv.org",
        "openreview.net", "neurips.cc", "proceedings.neurips.cc",
        "aclanthology.org", "proceedings.mlr.press",
    ],
    "code": [
        "github.com", "githubusercontent.com", "gitlab.com",
        "gitee.com", "gitcode.com", "bitbucket.org", "pypi.org", "npmjs.com",
    ],
    "spec": [
        "rfc-editor.org", "datatracker.ietf.org", "w3.org",
        "whatwg.org", "ecma-international.org", "khronos.org",
    ],
    "docs": [
        "readthedocs.io", "developer.mozilla.org",
        "learn.microsoft.com", "docs.python.org",
    ],
}


def _parse_published_date(value: str | None) -> str | None:
    """RFC 1123 → ISO 8601 UTC Z（§4.3）。"""
    if not value:
        return None
    try:
        dt = email.utils.parsedate_to_datetime(value)
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        logger.debug("Tavily 日期解析失败: %r", value)
        return None


class TavilyProvider(SearchProvider):
    """Tavily Search API。"""

    BASE_URL = "https://api.tavily.com/search"

    def __init__(self, api_key: str, client: httpx.AsyncClient) -> None:
        self._api_key = api_key
        self._client = client

    @property
    def engine_name(self) -> str:
        return "tavily"

    async def search(
        self,
        query: str,
        count: int = 10,
        exclude_categories: list[str] | None = None,
        need_passage: bool = True,
    ) -> list[RawSource]:
        # 构造 exclude_domains（L1 过滤，§6.1）
        exclude_domains: list[str] = []
        for cat in (exclude_categories or []):
            exclude_domains.extend(CATEGORY_DOMAINS.get(cat, []))

        payload: dict[str, Any] = {
            "query": query,
            "max_results": count,
            "include_raw_content": False,
            "include_published_date": True,  # M0: 不传则无 published_date 键
            "include_favicon": True,
            "search_depth": "advanced",
        }
        if exclude_domains:
            payload["exclude_domains"] = exclude_domains
        if need_passage:
            payload["include_raw_content"] = False  # content 字段已有摘要，不需要全文

        resp = await self._client.post(
            self.BASE_URL,
            json=payload,
            headers={"Authorization": f"Bearer {self._api_key}"},
        )
        resp.raise_for_status()
        data = resp.json()

        results = []
        for item in data.get("results", []):
            url_raw: str = item.get("url", "")
            disp_url = display_url(url_raw)
            sid = stable_id(url_raw)
            domain = extract_domain(url_raw)
            cat, cat_rule = classify_source(domain)

            published_at = _parse_published_date(item.get("published_date"))

            # passage 原料：Tavily 用 content 字段（§4.4）
            raw_content: str | None = item.get("content")

            src = RawSource(
                id=sid,
                title=item.get("title", ""),
                url=disp_url,
                domain=domain,
                favicon_url=item.get("favicon") or None,
                engine="tavily",
                category=cat,
                category_source="rule",
                published_at=published_at,
                confidence=None,
                _raw_score=item.get("score"),
                _rerank_score=None,
                _authority_signal=None,
                _norm_url=disp_url,
                _matched_queries=[],
                _summary=None,
                _content=raw_content,
            )
            results.append(src)

        return results
