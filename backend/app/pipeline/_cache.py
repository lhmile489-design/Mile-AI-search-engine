"""缓存键生成与 L2 回放逻辑（内部模块）。"""

from __future__ import annotations

import asyncio
import hashlib
import json as _json
import logging
import time
import uuid
import unicodedata
from typing import Any

from app.config import get_settings
from app.db import insert_history
from app.pipeline._frames import _make_frame, _trace, _full_source_dict, _raw_source_dict

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 缓存键生成
# ---------------------------------------------------------------------------


def _make_l2_key(query: str, focus_mode: str, engine: str, scope_filters: list[str]) -> str:
    """L2 缓存键：对 normalize(query)/focusMode/engine/sorted(scopeFilters) 取 sha256。"""
    normalized = unicodedata.normalize("NFC", query.strip().lower())
    parts = [normalized, focus_mode, engine] + sorted(scope_filters)
    raw = "\x00".join(parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _make_l1_key(engine: str, scope_filters: list[str], sub_query: str) -> str:
    """L1 缓存键：engine + scopeFilters + sub_query。"""
    parts = [engine] + sorted(scope_filters) + [sub_query.strip()]
    raw = "\x00".join(parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# L2 缓存回放
# ---------------------------------------------------------------------------


async def _replay_cache(
    cache_payload: dict[str, Any],
    put,
    is_disconnected,
    ms_since_start,
    request_id: str,
    query: str,
    focus_mode: str,
    engine: str,
    scope_filters: list[str],
    t0: float,
    trace_events: list[dict],
) -> None:
    """按原事件顺序回放缓存产物，所有耗时用本次真实计时。"""

    settings = get_settings()

    rewritten_queries: list[str] = cache_payload["rewritten_queries"]
    all_raw: list[RawSource] = cache_payload["all_raw"]
    ranked_sources: list[FullSource] = cache_payload["ranked_sources"]
    engines_used: list[str] = cache_payload["engines_used"]
    degraded: bool = cache_payload["degraded"]
    report_text: str = cache_payload["report_text"]
    citations: list[dict] = cache_payload["citations"]
    takeaways = cache_payload["takeaways"]
    follow_ups = cache_payload["follow_ups"]
    consensus = cache_payload["consensus"]
    token_stats = cache_payload["token_stats"]

    # --- 阶段 1：改写回放 ---
    t_rewrite_start = time.perf_counter()
    await put("trace", _trace("rewriting", "start", ms_since_start(), "开始改写检索词", cache_hit=True))
    # 模拟极短延迟让时间戳非 0
    await asyncio.sleep(0)
    t_rewrite_end = time.perf_counter()
    rewrite_ms = int((t_rewrite_end - t_rewrite_start) * 1000)

    await put(
        "trace",
        _trace(
            "rewriting", "end", ms_since_start(),
            f"改写出 {len(rewritten_queries)} 个检索词（缓存回放）",
            elapsed_ms=rewrite_ms,
            detail={"queries": rewritten_queries, "fallback": False, "fallbackCode": None},
            cache_hit=True,
        ),
    )

    # --- 阶段 2：检索回放 ---
    if await is_disconnected():
        logger.info("[%s] 客户端已断开（缓存回放检索前）", request_id)
        return

    t_search_start = time.perf_counter()
    await put(
        "trace",
        _trace(
            "searching", "start", ms_since_start(), "开始并发检索（缓存回放）",
            detail={"engine": engine, "queryCount": len(rewritten_queries)},
            cache_hit=True,
        ),
    )

    # 按原有 queryIndex 分组发 raw sources
    from collections import defaultdict
    raw_by_query: dict[int, list[RawSource]] = defaultdict(list)
    for src in all_raw:
        for qidx in (src._matched_queries or [0]):
            raw_by_query[qidx].append(src)

    for qidx in sorted(raw_by_query):
        if await is_disconnected():
            logger.info("[%s] 客户端已断开（缓存回放检索中）", request_id)
            return
        await put(
            "sources",
            {
                "phase": "raw",
                "engine": engine,
                "queryIndex": qidx,
                "items": [_raw_source_dict(r, qidx) for r in raw_by_query[qidx]],
            },
        )

    t_search_end = time.perf_counter()
    search_ms = int((t_search_end - t_search_start) * 1000)

    await put(
        "trace",
        _trace(
            "searching", "end", ms_since_start(),
            f"检索完成，共 {len(all_raw)} 条（缓存回放）",
            elapsed_ms=search_ms,
            detail={"enginesUsed": engines_used, "rawCount": len(all_raw), "failedQueries": []},
            cache_hit=True,
        ),
    )

    # --- 阶段 3：重排回放 ---
    if await is_disconnected():
        logger.info("[%s] 客户端已断开（缓存回放重排前）", request_id)
        return

    t_reason_start = time.perf_counter()
    await put("trace", _trace("reasoning", "start", ms_since_start(), "开始分类重排（缓存回放）", cache_hit=True))

    await put(
        "sources",
        {
            "phase": "ranked",
            "engine": engine,
            "queryIndex": None,
            "items": [_full_source_dict(s) for s in ranked_sources],
        },
    )

    t_reason_end = time.perf_counter()
    reason_ms = int((t_reason_end - t_reason_start) * 1000)

    await put(
        "trace",
        _trace(
            "reasoning", "end", ms_since_start(),
            f"重排完成，取前 {len(ranked_sources)} 个信源（缓存回放）",
            elapsed_ms=reason_ms,
            cache_hit=True,
        ),
    )

    # --- 阶段 4：生成回放（按块发 token）---
    if await is_disconnected():
        logger.info("[%s] 客户端已断开（缓存回放生成前）", request_id)
        return

    t_gen_start = time.perf_counter()
    await put(
        "trace",
        _trace(
            "generating", "start", ms_since_start(), "开始生成研报（缓存回放）",
            cache_hit=True,
        ),
    )

    # 按 20-60 字符切块，前端按累计文本整体渲染
    CHUNK_SIZE = 40
    first_token_ms: int | None = None
    for i in range(0, len(report_text), CHUNK_SIZE):
        if await is_disconnected():
            logger.info("[%s] 客户端已断开（缓存回放 token 中）", request_id)
            return
        delta = report_text[i: i + CHUNK_SIZE]
        if first_token_ms is None:
            first_token_ms = int((time.perf_counter() - t_gen_start) * 1000)
        await put("token", {"delta": delta})

    t_gen_end = time.perf_counter()
    gen_ms = int((t_gen_end - t_gen_start) * 1000)

    await put(
        "trace",
        _trace(
            "generating", "end", ms_since_start(),
            f"研报生成完成，共 {len(report_text)} 字（缓存回放）",
            elapsed_ms=gen_ms,
            detail={"firstTokenMs": first_token_ms, "charCount": len(report_text)},
            cache_hit=True,
        ),
    )

    # --- 回放写新历史记录 ---
    history_id: str | None = None
    stage_timings: dict[str, int] = {
        "rewritingMs": rewrite_ms,
        "searchingMs": search_ms,
        "reasoningMs": reason_ms,
        "generatingMs": gen_ms,
        "finalizingMs": 0,
        "firstTokenMs": (int((t_gen_start - t0) * 1000) + (first_token_ms or 0)),
    }

    try:
        now_ms = int(time.time() * 1000)
        hist_id = f"hist_{now_ms}_{str(uuid.uuid4())[:8]}"

        db_row = {
            "id": hist_id,
            "query": query,
            "focus_mode": focus_mode,
            "requested_engine": engine,
            "engines_used": _json.dumps(engines_used, ensure_ascii=False),
            "degraded": 1 if degraded else 0,
            "scope_filters": _json.dumps(scope_filters, ensure_ascii=False),
            "rewritten_queries": _json.dumps(rewritten_queries, ensure_ascii=False),
            "stage_timings": _json.dumps(stage_timings, ensure_ascii=False),
            "trace_events": _json.dumps(trace_events, ensure_ascii=False),
            "raw_sources": _json.dumps([_raw_source_dict(s, 0) for s in all_raw], ensure_ascii=False),
            "sources": _json.dumps([_full_source_dict(s) for s in ranked_sources], ensure_ascii=False),
            "report_text": report_text,
            "citations": _json.dumps(citations, ensure_ascii=False) if citations else None,
            "takeaways": _json.dumps(takeaways, ensure_ascii=False) if takeaways else None,
            "follow_ups": _json.dumps(follow_ups, ensure_ascii=False) if follow_ups else None,
            "consensus": _json.dumps(consensus, ensure_ascii=False) if consensus else None,
            "latency_ms": ms_since_start(),
            "token_stats": _json.dumps(token_stats, ensure_ascii=False) if token_stats else None,
            "llm_model": settings.llm_model,
            "source_count": len(ranked_sources),
            "char_count": len(report_text),
            "cache_hit": 1,
            "created_at": now_ms,
            "updated_at": now_ms,
        }

        await insert_history(db_row)
        history_id = hist_id
        logger.info("[%s] 缓存回放写库成功: %s", request_id, hist_id)

    except Exception as exc:
        logger.error(
            "[%s] 缓存回放写库失败: %s: %s",
            request_id, type(exc).__name__, repr(exc),
        )

    if follow_ups:
        await put("related", {"items": follow_ups})

    await put(
        "done",
        {
            "historyId": history_id,
            "latencyMs": ms_since_start(),
            "stageTimings": stage_timings,
            "firstTokenMs": stage_timings["firstTokenMs"],
            "tokenStats": token_stats,
            "citations": citations,
            "takeaways": takeaways,
            "consensus": consensus,
            "engine": engine,
            "enginesUsed": engines_used,
            "degraded": degraded,
            "sourceCount": len(ranked_sources),
            "charCount": len(report_text),
            "cacheHit": True,
        },
    )

    logger.info(
        "[%s] 缓存回放完成，总耗时 %dms", request_id, ms_since_start(),
    )


