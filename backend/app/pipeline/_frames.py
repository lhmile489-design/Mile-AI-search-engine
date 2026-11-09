"""SSE 帧格式化与 SourceCard 序列化（内部工具函数）。"""

from __future__ import annotations

import json
from typing import Any


# SSE 帧格式化
# ---------------------------------------------------------------------------


def _make_frame(event: str, data: dict[str, Any], eid: int) -> str:
    """序列化一帧 SSE（§2.4）。ensure_ascii=False，单行 data。"""
    data_str = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"id: {eid}\nevent: {event}\ndata: {data_str}\n\n"


def _trace(
    step: str,
    status: str,
    at_ms: int,
    message: str,
    elapsed_ms: int | None = None,
    detail: dict | None = None,
    cache_hit: bool = False,
) -> dict[str, Any]:
    return {
        "step": step,
        "status": status,
        "atMs": at_ms,
        "elapsedMs": elapsed_ms,
        "message": message,
        "detail": detail,
        "cacheHit": cache_hit,
    }


def _error_payload(
    code: int,
    message: str,
    step: str | None,
    retryable: bool,
    upstream: str | None = None,
) -> dict[str, Any]:
    return {
        "code": code,
        "message": message,
        "step": step,
        "retryable": retryable,
        "upstream": upstream,
    }


# ---------------------------------------------------------------------------
# SourceCard 序列化（raw / ranked）
# ---------------------------------------------------------------------------


def _raw_source_dict(src: RawSource, query_index: int) -> dict[str, Any]:
    """raw 批次精简字段（§4.1 raw 含 = 是）。"""
    return {
        "id": src.id,
        "index": None,
        "title": src.title,
        "url": src.url,
        "domain": src.domain,
        "faviconUrl": src.favicon_url,
        "engine": src.engine,
        "category": src.category,
        "categorySource": src.category_source,
        "confidence": src.confidence,
        "publishedAt": src.published_at,
    }


def _full_source_dict(src: FullSource) -> dict[str, Any]:
    """ranked 批次完整字段（§4.1）。"""
    return {
        "id": src.id,
        "index": src.index,
        "title": src.title,
        "url": src.url,
        "domain": src.domain,
        "faviconUrl": src.favicon_url,
        "engine": src.engine,
        "category": src.category,
        "categorySource": src.category_source,
        "categoryRule": src.category_rule,
        "confidence": src.confidence,
        "publishedAt": src.published_at,
        "passage": src.passage,
        "passageTruncated": src.passage_truncated,
        "scores": src.scores,
        "engineSignals": src.engine_signals,
        "matchedQueries": src.matched_queries,
        "bibtex": src.bibtex,
        "pdfUrl": src.pdf_url,
    }


# ---------------------------------------------------------------------------
