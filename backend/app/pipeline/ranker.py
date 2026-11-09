"""重排模块（§5）。

重排公式：final = w_rel * relevance + w_auth * authority + w_fresh * freshness
freshness 缺失时权重按比例重分到其余项。
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any

from app.pipeline.classifier import get_authority
from app.pipeline.providers import RawSource, FullSource, clean_passage, normalize_url

# ---------------------------------------------------------------------------
# 权重配置（§5.2）
# ---------------------------------------------------------------------------

_WEIGHTS: dict[str, dict[str, float]] = {
    "academic": {"relevance": 0.30, "authority": 0.50, "freshness": 0.20},
    "code":     {"relevance": 0.40, "authority": 0.40, "freshness": 0.20},
    "web":      {"relevance": 0.50, "authority": 0.35, "freshness": 0.15},
}

_FRESHNESS_HALF_LIFE_DAYS = 365.0


# ---------------------------------------------------------------------------
# 公共函数
# ---------------------------------------------------------------------------

def compute_freshness(published_at: str | None) -> float | None:
    """0.5 ^ (ageDays / 365)；缺失返回 None；未来日期返回 1.0（§5.1）。"""
    if not published_at:
        return None
    try:
        dt = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
        now = datetime.now(tz=timezone.utc)
        age_days = (now - dt).total_seconds() / 86400.0
        if age_days <= 0:
            return 1.0
        return 0.5 ** (age_days / _FRESHNESS_HALF_LIFE_DAYS)
    except Exception:
        return None


def compute_score(
    engine: str,
    raw_score: float | None,
    rerank_score: float | None,
    authority: float,
    freshness: float | None,
    focus_mode: str,
) -> tuple[float, dict[str, Any]]:
    """计算 final 分和 scores 对象（§5）。

    返回 (final_score, scores_dict)。
    scores_dict 键：relevance, authority, freshness, final, weights。
    """
    weights = _WEIGHTS.get(focus_mode, _WEIGHTS["web"]).copy()

    if engine == "deepseek":
        # §5.3：DeepSeek rerank_score 已混合权威+时效，final = relevance = score/3
        relevance = min(max((rerank_score or 0.0) / 3.0, 0.0), 1.0) if rerank_score is not None else None
        actual_weights = {"relevance": 1.0, "authority": 0.0, "freshness": 0.0}
        final = relevance if relevance is not None else 0.0
        return final, {
            "relevance": relevance,
            "authority": authority,    # 展示用，不进 final
            "freshness": freshness,    # 展示用，不进 final
            "final": final,
            "weights": actual_weights,
        }

    # Tavily：纯相关性分
    relevance = raw_score  # 0–1

    if freshness is None:
        # 权重重分
        w_rel = weights["relevance"]
        w_auth = weights["authority"]
        total = w_rel + w_auth
        actual_weights = {
            "relevance": round(w_rel / total, 6),
            "authority": round(w_auth / total, 6),
            "freshness": 0.0,
        }
        final = (
            actual_weights["relevance"] * (relevance or 0.0)
            + actual_weights["authority"] * authority
        )
    else:
        actual_weights = {k: v for k, v in weights.items()}
        final = (
            weights["relevance"] * (relevance or 0.0)
            + weights["authority"] * authority
            + weights["freshness"] * freshness
        )

    return final, {
        "relevance": relevance,
        "authority": authority,
        "freshness": freshness,
        "final": round(final, 6),
        "weights": actual_weights,
    }


def rank_sources(
    sources: list[RawSource],
    focus_mode: str,
    scope_filters: list[str],
    top_k: int = 10,
) -> list[FullSource]:
    """去重 → 范围过滤 → 分类 → 重排 → 取前 K（§6.3 pipeline §3.3 trace 字段）。

    返回 FullSource 列表（已设置 index 从 1 开始）。
    同时在 RawSource._matched_queries 中记录合并信息（调用前已由检索层填写）。
    """
    # --- 去重：同归一化 URL 保留得分最高的一条 ---
    seen: dict[str, RawSource] = {}
    for src in sources:
        key = normalize_url(src.url)
        existing = seen.get(key)
        if existing is None:
            seen[key] = src
        else:
            # 合并 matchedQueries
            combined = list(set(existing._matched_queries + src._matched_queries))
            # 保留分最高的
            new_score = src._raw_score or src._rerank_score or 0.0
            old_score = existing._raw_score or existing._rerank_score or 0.0
            if new_score > old_score:
                src._matched_queries = combined
                seen[key] = src
            else:
                existing._matched_queries = combined

    deduped = list(seen.values())

    # --- L3 范围过滤：将 scopeFilters 里允许的类别之外的来源过滤掉 ---
    # scopeFilters 语义是「允许」的类别；空列表表示不限
    if scope_filters:
        filtered = [s for s in deduped if s.category in scope_filters]
    else:
        filtered = deduped

    # --- 计算分数并重排 ---
    scored: list[tuple[float, RawSource]] = []
    for src in filtered:
        authority = get_authority(src.domain)
        freshness = compute_freshness(src.published_at)
        final, scores = compute_score(
            engine=src.engine,
            raw_score=src._raw_score,
            rerank_score=src._rerank_score,
            authority=authority,
            freshness=freshness,
            focus_mode=focus_mode,
        )
        scored.append((final, src))

        # 暂存 scores 到 _raw_score 字段位置（用 setattr 避免 dataclass 重建）
        object.__setattr__(src, "__scores__", scores)
        object.__setattr__(src, "__authority__", authority)
        object.__setattr__(src, "__freshness__", freshness)

    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[:top_k]

    # --- 构建 FullSource ---
    full_sources: list[FullSource] = []
    for idx, (final, src) in enumerate(top, start=1):
        scores = getattr(src, "__scores__", {})
        authority = getattr(src, "__authority__", 0.5)

        # passage
        passage_raw = src._summary or src._content
        passage, passage_truncated = clean_passage(passage_raw)

        # pdfUrl
        from urllib.parse import urlparse
        pdf_url = src.url if urlparse(src.url).path.lower().endswith(".pdf") else None

        # bibtex：仅 preprint，元数据不全时为 None（F13，M5）
        from app.pipeline.bibtex import generate_bibtex
        bibtex = generate_bibtex(src)

        engine_signals: dict[str, Any] = {}
        if src.engine == "tavily":
            engine_signals = {"score": src._raw_score}
        elif src.engine == "deepseek":
            engine_signals = {
                "rerankScore": src._rerank_score,
                "authority": src._authority_signal,
            }

        from app.pipeline.classifier import classify_source
        cat, cat_rule = classify_source(src.domain)

        full = FullSource(
            id=src.id,
            title=src.title,
            url=src.url,
            domain=src.domain,
            favicon_url=src.favicon_url,
            engine=src.engine,
            category=cat,
            category_source="rule",
            published_at=src.published_at,
            confidence=None,
            _raw_score=src._raw_score,
            _rerank_score=src._rerank_score,
            _authority_signal=src._authority_signal,
            _norm_url=src._norm_url,
            _matched_queries=src._matched_queries,
            _summary=src._summary,
            _content=src._content,
            # FullSource 扩展字段
            index=idx,
            category_rule=cat_rule,
            passage=passage,
            passage_truncated=passage_truncated,
            scores=scores,
            engine_signals=engine_signals,
            matched_queries=src._matched_queries,
            bibtex=bibtex,
            pdf_url=pdf_url,
        )
        full_sources.append(full)

    return full_sources


def rank_stats(
    all_raw: list[RawSource],
    scope_filters: list[str],
    full_sources: list[FullSource],
) -> dict[str, int]:
    """生成 reasoning end trace detail 所需的统计数（§3.1）。"""
    from app.pipeline.providers import normalize_url as nu
    seen_urls: set[str] = set()
    deduped_count = 0
    for s in all_raw:
        key = nu(s.url)
        if key not in seen_urls:
            seen_urls.add(key)
            deduped_count += 1

    if scope_filters:
        filtered_count = sum(1 for s in all_raw if normalize_url(s.url) in {nu(x.url) for x in full_sources} or (normalize_url(s.url) in seen_urls and s.category in scope_filters))
        # 简化：直接算
        filtered_count = sum(1 for url in seen_urls if any(s.domain for s in all_raw if normalize_url(s.url) == url))
        # 更精确：对去重后结果里落在 scope 内的计数
        filtered_count = sum(
            1 for key, _ in {nu(s.url): s for s in all_raw}.items()
            if any(s.category in scope_filters for s in all_raw if nu(s.url) == key)
        )
    else:
        filtered_count = deduped_count

    return {
        "inputCount": len(all_raw),
        "dedupedCount": deduped_count,
        "filteredCount": filtered_count,
        "rankedCount": len(full_sources),
        "k": len(full_sources),
    }
