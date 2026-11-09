"""数据库模块：连接管理、迁移执行器、CRUD 封装。

所有 sqlite3 调用通过 asyncio.to_thread 包装，不阻塞事件循环。
连接使用 WAL 模式，PRAGMA foreign_keys = ON。
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import sqlite3
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_conn: sqlite3.Connection | None = None


def _get_conn() -> sqlite3.Connection:
    """返回全局单连接（进程内单用户，不需要连接池）。"""
    global _conn
    if _conn is None:
        raise RuntimeError("数据库尚未初始化，请先调用 init_db()")
    return _conn


# ---------------------------------------------------------------------------
# 初始化 & 迁移
# ---------------------------------------------------------------------------

def _run_migrations(conn: sqlite3.Connection, migrations_dir: Path, db_path: str) -> None:
    """按版本号顺序执行未应用的 V{n}__*.sql 迁移脚本。"""
    # 确保 schema_version 表存在（第一次初始化时 V1 还没跑）
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_version "
        "(version INTEGER PRIMARY KEY, description TEXT NOT NULL, applied_at INTEGER NOT NULL)"
    )
    conn.commit()

    applied = {row[0] for row in conn.execute("SELECT version FROM schema_version")}

    # 收集迁移文件：文件名形如 V1__init.sql
    files: list[tuple[int, Path]] = []
    for p in sorted(migrations_dir.glob("V*__*.sql")):
        m = re.match(r"V(\d+)__", p.name)
        if not m:
            continue
        files.append((int(m.group(1)), p))

    # 检查版本号无重复、无断号
    versions = [v for v, _ in files]
    if len(versions) != len(set(versions)):
        raise RuntimeError(f"迁移文件版本号重复：{versions}")
    for i, v in enumerate(sorted(versions), start=1):
        if v != i:
            raise RuntimeError(f"迁移文件版本号断号：期望 {i}，实际 {v}")

    db_file = Path(db_path)
    for version, path in sorted(files):
        if version in applied:
            continue

        description = path.stem  # e.g. V1__init
        backup = db_file.with_suffix(f".db.bak.V{version}") if db_file.exists() else None

        if backup and db_file.exists():
            shutil.copy2(str(db_file), str(backup))
            logger.info("迁移前备份: %s", backup)

        sql = path.read_text(encoding="utf-8")
        logger.info("执行迁移 %s", path.name)
        try:
            conn.executescript(sql)  # executescript 自动 commit
            conn.execute(
                "INSERT INTO schema_version (version, description, applied_at) VALUES (?, ?, ?)",
                (version, description, int(time.time() * 1000)),
            )
            conn.commit()
        except Exception as exc:
            conn.rollback()
            logger.error("迁移 %s 失败，已回滚: %s", path.name, exc)
            raise RuntimeError(f"迁移 {path.name} 失败，应用拒绝启动") from exc


def init_db(database_path: str) -> None:
    """初始化数据库连接并执行待执行的迁移（同步，在 lifespan 中调用）。"""
    global _conn
    db_file = Path(database_path)
    db_file.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(db_file), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.commit()

    migrations_dir = Path(__file__).parent / "migrations"
    _run_migrations(conn, migrations_dir, database_path)

    _conn = conn
    logger.info("数据库初始化完成: %s", db_file)


def close_db() -> None:
    global _conn
    if _conn:
        _conn.close()
        _conn = None


# ---------------------------------------------------------------------------
# CRUD 封装
# ---------------------------------------------------------------------------

async def insert_history(row: dict[str, Any]) -> None:
    """写入一条 search_history 记录（异步包装）。"""
    def _insert() -> None:
        conn = _get_conn()
        conn.execute(
            """INSERT INTO search_history (
                id, query, focus_mode, requested_engine, engines_used,
                degraded, scope_filters, rewritten_queries, stage_timings,
                trace_events, raw_sources, sources, report_text,
                citations, takeaways, follow_ups, consensus,
                latency_ms, token_stats, llm_model, source_count,
                char_count, cache_hit, created_at, updated_at
            ) VALUES (
                :id, :query, :focus_mode, :requested_engine, :engines_used,
                :degraded, :scope_filters, :rewritten_queries, :stage_timings,
                :trace_events, :raw_sources, :sources, :report_text,
                :citations, :takeaways, :follow_ups, :consensus,
                :latency_ms, :token_stats, :llm_model, :source_count,
                :char_count, :cache_hit, :created_at, :updated_at
            )""",
            row,
        )
        conn.commit()

    await asyncio.to_thread(_insert)


async def get_history_list(
    page: int = 1,
    page_size: int = 20,
    q: str | None = None,
) -> dict[str, Any]:
    """历史列表（按 created_at 倒序分页）。"""
    def _query() -> dict[str, Any]:
        conn = _get_conn()
        offset = (page - 1) * page_size

        if q:
            like = f"%{q}%"
            total = conn.execute(
                "SELECT COUNT(*) FROM search_history WHERE query LIKE ?", (like,)
            ).fetchone()[0]
            rows = conn.execute(
                "SELECT id, query, focus_mode, requested_engine, created_at, "
                "source_count, char_count, latency_ms, cache_hit "
                "FROM search_history WHERE query LIKE ? "
                "ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
                (like, page_size, offset),
            ).fetchall()
        else:
            total = conn.execute("SELECT COUNT(*) FROM search_history").fetchone()[0]
            rows = conn.execute(
                "SELECT id, query, focus_mode, requested_engine, created_at, "
                "source_count, char_count, latency_ms, cache_hit "
                "FROM search_history "
                "ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
                (page_size, offset),
            ).fetchall()

        records = []
        for row in rows:
            records.append({
                "id": row["id"],
                "query": row["query"],
                "focusMode": row["focus_mode"],
                "engine": row["requested_engine"],
                "createdAt": _ms_to_iso(row["created_at"]),
                "sourceCount": row["source_count"],
                "charCount": row["char_count"],
                "latencyMs": row["latency_ms"],
                "cacheHit": bool(row["cache_hit"]),
            })
        return {"total": total, "records": records}

    return await asyncio.to_thread(_query)


async def get_history_by_id(history_id: str) -> dict[str, Any] | None:
    """获取单条历史完整快照。"""
    def _query() -> dict[str, Any] | None:
        conn = _get_conn()
        row = conn.execute(
            "SELECT * FROM search_history WHERE id = ?", (history_id,)
        ).fetchone()
        if row is None:
            return None
        return _row_to_detail(row)

    return await asyncio.to_thread(_query)


async def delete_history_by_id(history_id: str) -> bool:
    """删除一条历史，返回是否存在并删除成功。"""
    def _delete() -> bool:
        conn = _get_conn()
        cursor = conn.execute("DELETE FROM search_history WHERE id = ?", (history_id,))
        conn.commit()
        return cursor.rowcount > 0

    return await asyncio.to_thread(_delete)


# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------

def _ms_to_iso(ms: int) -> str:
    """毫秒时间戳转 ISO 8601 UTC 字符串（精确到毫秒）。"""
    import datetime
    dt = datetime.datetime.fromtimestamp(ms / 1000.0, tz=datetime.timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def _row_to_detail(row: sqlite3.Row) -> dict[str, Any]:
    """将数据库行转为历史详情 API 响应字典。"""
    def j(v: str | None) -> Any:
        return json.loads(v) if v else None

    return {
        "id": row["id"],
        "query": row["query"],
        "focusMode": row["focus_mode"],
        "engine": row["requested_engine"],
        "enginesUsed": j(row["engines_used"]) or [],
        "degraded": bool(row["degraded"]),
        "scopeFilters": j(row["scope_filters"]) or [],
        "rewrittenQueries": j(row["rewritten_queries"]) or [],
        "stageTimings": j(row["stage_timings"]) or {},
        "traceEvents": j(row["trace_events"]) or [],
        "sources": j(row["sources"]) or [],
        "report": row["report_text"],
        "citations": j(row["citations"]) or [],
        "takeaways": j(row["takeaways"]),
        "followUps": j(row["follow_ups"]),
        "consensus": j(row["consensus"]),
        "latencyMs": row["latency_ms"],
        "tokenStats": j(row["token_stats"]),
        "llmModel": row["llm_model"],
        "sourceCount": row["source_count"],
        "charCount": row["char_count"],
        "cacheHit": bool(row["cache_hit"]),
        "createdAt": _ms_to_iso(row["created_at"]),
        "updatedAt": _ms_to_iso(row["updated_at"]),
    }
