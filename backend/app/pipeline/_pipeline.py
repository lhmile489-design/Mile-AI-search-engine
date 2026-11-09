"""流水线主任务（_pipeline_task）。

把完整检索→排序→生成→收尾流水线封装为 asyncio.Task，
把每帧 put 进队列；结束时 put(None) 通知外层生成器。
"""

from __future__ import annotations

import asyncio
import logging
import json as _json
import time
import uuid
from typing import Any

import httpx
from fastapi import Request

from app.config import get_settings
from app.pipeline._cache import _make_l1_key, _make_l2_key, _replay_cache
from app.pipeline._frames import (
    _error_payload,
    _full_source_dict,
    _make_frame,
    _raw_source_dict,
    _trace,
)
from app.pipeline.classifier import classify_source
from app.pipeline.finalizer import compute_consensus, finalize, parse_citations
from app.pipeline.generator import generate_report
from app.pipeline.providers import FullSource, RawSource, normalize_url
from app.pipeline.providers.deepseek_search import DeepSeekSearchProvider
from app.pipeline.providers.tavily import TavilyProvider
from app.pipeline.ranker import rank_sources, rank_stats
from app.pipeline.rewriter import rewrite_query

logger = logging.getLogger(__name__)


async def _pipeline_task(
    request: Request,
    query: str,
    focus_mode: str,
    engine: str,
    scope_filters: list[str],
    queue: asyncio.Queue[str | None],
    request_id: str,
    t0: float,
    cache_payload: dict[str, Any] | None,
) -> None:
    """把完整流水线逻辑封装为 asyncio.Task；把每个 SSE 帧 put 进 queue。
    结束（正常或异常）时 put(None) 通知外层生成器停止。

    cache_payload 非 None 时走 L2 缓存回放路径，跳过真实检索和生成。
    """
    settings = get_settings()
    eid = 0
    trace_events: list[dict] = []
    task_cancelled = False  # 标记是否因取消/异常退出（用于 finally 是否清空队列）

    def ms_since_start() -> int:
        return int((time.perf_counter() - t0) * 1000)

    async def put(event: str, data: dict) -> None:
        nonlocal eid
        eid += 1
        frame = _make_frame(event, data, eid)
        if event == "trace":
            trace_events.append(data)
        await queue.put(frame)

    async def is_disconnected() -> bool:
        try:
            return await request.is_disconnected()
        except Exception:
            return False

    # 检索阶段创建的子任务列表，中止时用于显式取消
    search_tasks: list[asyncio.Task] = []
    current_phase = "init"

    try:
        # ----------------------------------------------------------------
        # L2 缓存回放路径
        # ----------------------------------------------------------------
        if cache_payload is not None:
            await _replay_cache(
                cache_payload=cache_payload,
                put=put,
                is_disconnected=is_disconnected,
                ms_since_start=ms_since_start,
                request_id=request_id,
                query=query,
                focus_mode=focus_mode,
                engine=engine,
                scope_filters=scope_filters,
                t0=t0,
                trace_events=trace_events,
            )
            return

        # ----------------------------------------------------------------
        # 真实流水线
        # ----------------------------------------------------------------
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as http_client:
            # 选择 Provider
            primary_provider: TavilyProvider | DeepSeekSearchProvider | None = None
            fallback_provider: TavilyProvider | DeepSeekSearchProvider | None = None

            if engine == "tavily" and settings.tavily_api_key:
                primary_provider = TavilyProvider(
                    settings.tavily_api_key.get_secret_value(), http_client
                )
                if settings.llm_api_key:
                    fallback_provider = DeepSeekSearchProvider(
                        settings.llm_api_key.get_secret_value(), http_client
                    )
            elif engine == "deepseek" and settings.llm_api_key:
                primary_provider = DeepSeekSearchProvider(
                    settings.llm_api_key.get_secret_value(), http_client
                )
                if settings.tavily_api_key:
                    fallback_provider = TavilyProvider(
                        settings.tavily_api_key.get_secret_value(), http_client
                    )

            if primary_provider is None:
                await put("error", _error_payload(40002, f"引擎 {engine} 未配置密钥", None, False))
                return

            llm_key = settings.llm_api_key.get_secret_value() if settings.llm_api_key else ""
            llm_base = settings.llm_base_url
            llm_model = settings.llm_model

            # ----------------------------------------------------------------
            # 阶段 1：改写
            # ----------------------------------------------------------------
            current_phase = "rewriting"
            if await is_disconnected():
                logger.info("[%s] 客户端已断开（改写前）", request_id)
                return

            t_rewrite_start = time.perf_counter()
            await put("trace", _trace("rewriting", "start", ms_since_start(), "开始改写检索词"))

            queries, fallback, fallback_code = await rewrite_query(
                query=query,
                focus_mode=focus_mode,
                scope_filters=scope_filters,
                llm_base_url=llm_base,
                llm_api_key=llm_key,
                llm_model=llm_model,
                client=http_client,
                timeout=settings.rewrite_timeout_s,
            )
            rewritten_queries = queries
            t_rewrite_end = time.perf_counter()
            rewrite_ms = int((t_rewrite_end - t_rewrite_start) * 1000)

            await put(
                "trace",
                _trace(
                    "rewriting", "end", ms_since_start(),
                    f"改写出 {len(queries)} 个检索词" + ("（降级）" if fallback else ""),
                    elapsed_ms=rewrite_ms,
                    detail={
                        "queries": queries,
                        "fallback": fallback,
                        "fallbackCode": fallback_code,
                    },
                ),
            )

            # ----------------------------------------------------------------
            # 阶段 2：检索
            # ----------------------------------------------------------------
            current_phase = "searching"
            if await is_disconnected():
                logger.info("[%s] 客户端已断开（检索前）", request_id)
                return

            t_search_start = time.perf_counter()
            await put(
                "trace",
                _trace(
                    "searching", "start", ms_since_start(), "开始并发检索",
                    detail={"engine": engine, "queryCount": len(queries)},
                ),
            )

            all_raw: list[RawSource] = []
            degraded = False
            engines_used_set: set[str] = set()
            failed_queries: list[int] = []

            # L1 缓存在 cache 模块里取，这里通过 get_l1_cache 拿
            from app.cache import get_l1_cached, set_l1_cache

            async def search_one(idx: int, q: str) -> tuple[int, list[RawSource], str]:
                nonlocal degraded
                # L1 命中
                l1_key = _make_l1_key(engine, scope_filters, q)
                l1_hit = get_l1_cached(l1_key)
                if l1_hit is not None:
                    logger.info("[%s] L1 命中: 子检索词 %d %r", request_id, idx, q)
                    for r in l1_hit:
                        r._matched_queries = [idx]
                    return idx, l1_hit, primary_provider.engine_name, True  # l1_hit=True

                try:
                    results = await asyncio.wait_for(
                        primary_provider.search(
                            q, count=10,
                            exclude_categories=[
                                s for s in ["preprint", "code", "spec", "docs", "blog"]
                                if s not in scope_filters
                            ] if scope_filters else None,
                        ),
                        timeout=settings.search_timeout_s,
                    )
                    for r in results:
                        r._matched_queries = [idx]
                    set_l1_cache(l1_key, results)
                    return idx, results, primary_provider.engine_name, False
                except Exception as exc_primary:
                    logger.warning(
                        "[%s] 主引擎 %s 查询 %d 失败: %s: %s",
                        request_id, primary_provider.engine_name, idx,
                        type(exc_primary).__name__, repr(exc_primary),
                    )

                    if fallback_provider is not None:
                        try:
                            results = await asyncio.wait_for(
                                fallback_provider.search(
                                    q, count=10,
                                    exclude_categories=[
                                        s for s in ["preprint", "code", "spec", "docs", "blog"]
                                        if s not in scope_filters
                                    ] if scope_filters else None,
                                ),
                                timeout=settings.search_timeout_s,
                            )
                            for r in results:
                                r._matched_queries = [idx]
                            degraded = True
                            set_l1_cache(l1_key, results)
                            return idx, results, fallback_provider.engine_name, False
                        except Exception as exc_fb:
                            logger.warning(
                                "[%s] 备用引擎失败: %s: %s",
                                request_id,
                                type(exc_fb).__name__, repr(exc_fb),
                            )

                return idx, [], "none", False

            # 显式保存任务，以便中止时取消
            search_tasks = [
                asyncio.create_task(search_one(i, q))
                for i, q in enumerate(queries)
            ]
            degraded_sent = False

            for fut in asyncio.as_completed(search_tasks):
                if await is_disconnected():
                    # 显式取消全部在飞任务
                    cancelled = sum(1 for t in search_tasks if t.cancel())
                    await asyncio.gather(*search_tasks, return_exceptions=True)
                    logger.info(
                        "[%s] 客户端已断开，阶段=searching，已取消 %d 个在飞任务",
                        request_id, cancelled,
                    )
                    return

                idx, results, eng, l1_hit = await fut
                if not results:
                    failed_queries.append(idx)
                    continue

                engines_used_set.add(eng)
                all_raw.extend(results)

                if not l1_hit and eng != primary_provider.engine_name and degraded and not degraded_sent:
                    degraded_sent = True
                    await put(
                        "trace",
                        _trace(
                            "searching", "degraded", ms_since_start(),
                            f"主引擎失败，已切换到 {eng}",
                            detail={
                                "from": primary_provider.engine_name,
                                "to": eng,
                                "code": 50201,
                                "queryIndex": idx,
                            },
                        ),
                    )

                await put(
                    "sources",
                    {
                        "phase": "raw",
                        "engine": eng,
                        "queryIndex": idx,
                        "items": [_raw_source_dict(r, idx) for r in results],
                    },
                )

            engines_used = sorted(engines_used_set)
            t_search_end = time.perf_counter()
            search_ms = int((t_search_end - t_search_start) * 1000)

            await put(
                "trace",
                _trace(
                    "searching", "end", ms_since_start(),
                    f"检索完成，共 {len(all_raw)} 条（去重前）",
                    elapsed_ms=search_ms,
                    detail={
                        "enginesUsed": engines_used,
                        "rawCount": len(all_raw),
                        "failedQueries": failed_queries,
                    },
                ),
            )

            if not all_raw:
                await put(
                    "error",
                    _error_payload(
                        50201, "所有子检索词均未返回结果，请稍后重试",
                        "searching", True,
                        "tavily" if engine == "tavily" else "deepseek_search",
                    ),
                )
                return

            # ----------------------------------------------------------------
            # 阶段 3：分类重排
            # ----------------------------------------------------------------
            current_phase = "reasoning"
            if await is_disconnected():
                logger.info("[%s] 客户端已断开（重排前）", request_id)
                return

            t_reason_start = time.perf_counter()
            await put("trace", _trace("reasoning", "start", ms_since_start(), "开始分类重排"))

            ranked_sources = rank_sources(
                all_raw,
                focus_mode=focus_mode,
                scope_filters=scope_filters,
                top_k=settings.ranking_top_k,
            )
            stats = rank_stats(all_raw, scope_filters, ranked_sources)

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
                    f"重排完成，取前 {len(ranked_sources)} 个信源",
                    elapsed_ms=reason_ms,
                    detail=stats,
                ),
            )

            # ----------------------------------------------------------------
            # 阶段 4：生成
            # ----------------------------------------------------------------
            current_phase = "generating"
            if await is_disconnected():
                logger.info("[%s] 客户端已断开（生成前）", request_id)
                return

            t_gen_start = time.perf_counter()
            await put(
                "trace",
                _trace(
                    "generating", "start", ms_since_start(), "开始生成研报",
                    detail={"model": llm_model, "sourceCount": len(ranked_sources)},
                ),
            )

            gen_first_token_ms: int | None = None
            report_text = ""
            token_stats: dict | None = None
            first_token_ms: int | None = None

            async for chunk in generate_report(
                query=query,
                sources=ranked_sources,
                llm_base_url=llm_base,
                llm_api_key=llm_key,
                llm_model=llm_model,
                client=http_client,
                first_token_timeout=settings.generate_first_token_timeout_s,
            ):
                if await is_disconnected():
                    logger.info("[%s] 客户端已断开（生成中）", request_id)
                    return

                if chunk["type"] == "token":
                    report_text += chunk["delta"]
                    await put("token", {"delta": chunk["delta"]})
                elif chunk["type"] == "done":
                    report_text = chunk["report"]
                    token_stats = chunk["usage"]
                    gen_first_token_ms = chunk["first_token_ms"]
                    first_token_ms = int(t_gen_start * 1000 - t0 * 1000) + (gen_first_token_ms or 0)
                elif chunk["type"] == "error":
                    exc = chunk["exc"]
                    code = chunk.get("code", 50202)
                    await put(
                        "error",
                        _error_payload(code, str(exc)[:200], "generating", True, "llm"),
                    )
                    return

            t_gen_end = time.perf_counter()
            gen_ms = int((t_gen_end - t_gen_start) * 1000)

            await put(
                "trace",
                _trace(
                    "generating", "end", ms_since_start(),
                    f"研报生成完成，共 {len(report_text)} 字",
                    elapsed_ms=gen_ms,
                    detail={
                        "firstTokenMs": gen_first_token_ms,
                        "charCount": len(report_text),
                    },
                ),
            )

            # ----------------------------------------------------------------
            # 收尾：引用解析、高亮、takeaways、共识度、写库
            # ----------------------------------------------------------------
            current_phase = "finalizing"
            t_final_start = time.perf_counter()

            citations, hallucinated = parse_citations(report_text, ranked_sources)
            if hallucinated:
                logger.info("[%s] 幻觉引用编号: %s", request_id, hallucinated)

            consensus = compute_consensus(report_text, citations, ranked_sources)

            takeaways, follow_ups = await finalize(
                report=report_text,
                citations=citations,
                sources=ranked_sources,
                llm_base_url=llm_base,
                llm_api_key=llm_key,
                llm_model=llm_model,
                client=http_client,
                timeout=settings.finalize_timeout_s,
            )

            if follow_ups:
                await put("related", {"items": follow_ups})

            # 写库
            history_id: str | None = None
            stage_timings: dict[str, int] = {
                "rewritingMs": rewrite_ms,
                "searchingMs": search_ms,
                "reasoningMs": reason_ms,
                "generatingMs": gen_ms,
                "firstTokenMs": first_token_ms or 0,
            }
            try:
                from app.db import insert_history

                t_final_end = time.perf_counter()
                final_ms = int((t_final_end - t_final_start) * 1000)
                stage_timings["finalizingMs"] = final_ms

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
                    "llm_model": llm_model,
                    "source_count": len(ranked_sources),
                    "char_count": len(report_text),
                    "cache_hit": 0,
                    "created_at": now_ms,
                    "updated_at": now_ms,
                }

                await insert_history(db_row)
                history_id = hist_id
                logger.info("[%s] 写库成功: %s", request_id, hist_id)

                # 写 L2 缓存（仅在成功且开启缓存时）
                from app.cache import set_l2_cache
                l2_key = _make_l2_key(query, focus_mode, engine, scope_filters)
                set_l2_cache(l2_key, {
                    "rewritten_queries": rewritten_queries,
                    "all_raw": all_raw,
                    "ranked_sources": ranked_sources,
                    "engines_used": engines_used,
                    "degraded": degraded,
                    "report_text": report_text,
                    "citations": citations,
                    "takeaways": takeaways,
                    "follow_ups": follow_ups,
                    "consensus": consensus,
                    "token_stats": token_stats,
                    "trace_events": trace_events,
                })

            except Exception as exc:
                logger.error(
                    "[%s] 写库失败（不影响响应）: %s: %s",
                    request_id, type(exc).__name__, repr(exc),
                )
                history_id = None

            await put(
                "done",
                {
                    "historyId": history_id,
                    "latencyMs": ms_since_start(),
                    "stageTimings": stage_timings,
                    "firstTokenMs": first_token_ms,
                    "tokenStats": token_stats,
                    "citations": citations,
                    "takeaways": takeaways,
                    "consensus": consensus,
                    "engine": engine,
                    "enginesUsed": engines_used,
                    "degraded": degraded,
                    "sourceCount": len(ranked_sources),
                    "charCount": len(report_text),
                    "cacheHit": False,
                },
            )

            logger.info(
                "[%s] 完成，总耗时 %dms，信源 %d，研报 %d 字",
                request_id, ms_since_start(), len(ranked_sources), len(report_text),
            )

    except asyncio.CancelledError:
        # 被 _disconnect_watcher 或 run_pipeline finally 取消
        task_cancelled = True
        cancelled = sum(1 for t in search_tasks if t.cancel())
        # 先记日志（在 await 之前，避免第二次 CancelledError 跳过日志）
        import sys as _sys
        _abort_msg = f"[{request_id}] 客户端已断开，阶段={current_phase}，已取消 {cancelled} 个在飞任务"
        logger.warning(_abort_msg)
        for _h in list(logger.handlers) + list(logging.root.handlers):
            try:
                _h.flush()
            except Exception:
                pass
        print(_abort_msg, flush=True, file=_sys.stderr)
        # gather 放在日志之后（gather 里的 await 可能被第二次 cancel 打断）
        if search_tasks:
            try:
                await asyncio.gather(*search_tasks, return_exceptions=True)
            except asyncio.CancelledError:
                pass
        raise  # 让 Task 以 CancelledError 结束

    except Exception as exc:
        task_cancelled = True  # 异常也需要清空队列（消费者可能不再消费了）
        logger.exception(
            "[%s] 流水线未捕获异常: %s: %s",
            request_id, type(exc).__name__, repr(exc),
        )
        try:
            await queue.put(
                _make_frame(
                    "error",
                    _error_payload(50001, f"内部错误: {str(exc)[:100]}", None, True),
                    -1,
                )
            )
        except Exception:
            pass

    finally:
        # 正常结束时直接放哨兵；取消/异常时先清空残留帧再放哨兵（防止消费者停止后 put 死锁）
        if task_cancelled:
            while not queue.empty():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
        try:
            queue.put_nowait(None)
        except asyncio.QueueFull:
            pass


