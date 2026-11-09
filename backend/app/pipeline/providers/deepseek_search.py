"""DeepSeek 搜索端点 Provider。

依据：接口设计 §4.3（publishedAt RFC 3339）、§5.3（口径修正）、M0 实测。
DeepSeek Search 不支持 exclude_domains，用 -site: 语法（§6.1 L2），128 字符预算。
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
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
from app.pipeline.providers.tavily import CATEGORY_DOMAINS

logger = logging.getLogger(__name__)

SEARCH_URL = "https://api.deepseek.com/v1/tools/search"
MAX_QUERY_LEN = 128


def _build_site_exclusion(query: str, exclude_categories: list[str]) -> str:
    """在 query 末尾贪心拼接 -site: 后缀（§6.1 L2），不超过 128 字符。"""
    if not exclude_categories:
        return query

    # 按域名总长升序贪心（放不下的交 L3 兜底）
    cats_by_len = sorted(
        exclude_categories,
        key=lambda c: sum(len(d) + len(" -site:") for d in CATEGORY_DOMAINS.get(c, [])),
    )

    suffix_parts: list[str] = []
    for cat in cats_by_len:
        domains = CATEGORY_DOMAINS.get(cat, [])
        candidate = " ".join(f"-site:{d}" for d in domains)
        trial = (query + " " + " ".join(suffix_parts) + " " + candidate).strip()
        if len(trial) <= MAX_QUERY_LEN:
            suffix_parts.extend(f"-site:{d}" for d in domains)

    if suffix_parts:
        return (query + " " + " ".join(suffix_parts))[:MAX_QUERY_LEN]
    return query[:MAX_QUERY_LEN]


def _parse_date(value: str | None) -> str | None:
    """RFC 3339 → ISO 8601 UTC Z（§4.3）。"""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        logger.debug("DeepSeek Search 日期解析失败: %r", value)
        return None


class DeepSeekSearchProvider(SearchProvider):
    """DeepSeek Search API（v1/tools/search）。"""

    def __init__(self, api_key: str, client: httpx.AsyncClient) -> None:
        self._api_key = api_key
        self._client = client

    @property
    def engine_name(self) -> str:
        return "deepseek"

    async def search(
        self,
        query: str,
        count: int = 10,
        exclude_categories: list[str] | None = None,
        need_passage: bool = True,
    ) -> list[RawSource]:
        actual_query = _build_site_exclusion(query, exclude_categories or [])

        payload: dict[str, Any] = {
            "query": actual_query,
            "count": min(count, 50),
            "need_content": False,  # summary 已够用，content 原长 15k 太贵
        }

        resp = await self._client.post(
            SEARCH_URL,
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

            published_at = _parse_date(item.get("date"))

            # §5.3：DeepSeek rerank_score 已混合权威+时效，单独处理
            rerank_score: float | None = item.get("rerank_score")
            authority_signal: int | None = item.get("authority")  # -1 表示未知

            src = RawSource(
                id=sid,
                title=item.get("title", ""),
                url=disp_url,
                domain=domain,
                favicon_url=item.get("site_icon") or None,
                engine="deepseek",
                category=cat,
                category_source="rule",
                published_at=published_at,
                confidence=None,
                _raw_score=None,
                _rerank_score=rerank_score,
                _authority_signal=authority_signal if authority_signal != -1 else None,
                _norm_url=disp_url,
                _matched_queries=[],
                _summary=item.get("summary"),  # passage 原料
                _content=None,
            )
            results.append(src)

        return results
