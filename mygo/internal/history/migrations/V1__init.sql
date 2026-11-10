-- V1__init.sql
-- 初始化 search_history 与 schema_version 表。
-- 所有语句均幂等（IF NOT EXISTS），可安全重复执行。
-- 依据：数据库设计 v1.0 §4

CREATE TABLE IF NOT EXISTS schema_version (
    version     INTEGER PRIMARY KEY,
    description TEXT    NOT NULL,
    applied_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS search_history (
    id                TEXT    PRIMARY KEY CHECK (substr(id, 1, 5) = 'hist_'),
    query             TEXT    NOT NULL CHECK (length(query) BETWEEN 1 AND 500),
    focus_mode        TEXT    NOT NULL CHECK (focus_mode IN ('academic', 'code', 'web')),
    requested_engine  TEXT    NOT NULL CHECK (requested_engine IN ('tavily', 'deepseek')),
    engines_used      TEXT    NOT NULL CHECK (json_valid(engines_used) AND json_type(engines_used) = 'array'),
    degraded          INTEGER NOT NULL DEFAULT 0 CHECK (degraded IN (0, 1)),
    scope_filters     TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(scope_filters) AND json_type(scope_filters) = 'array'),
    rewritten_queries TEXT    NOT NULL CHECK (json_valid(rewritten_queries) AND json_type(rewritten_queries) = 'array'),
    stage_timings     TEXT    NOT NULL CHECK (json_valid(stage_timings) AND json_type(stage_timings) = 'object'),
    trace_events      TEXT    NOT NULL CHECK (json_valid(trace_events) AND json_type(trace_events) = 'array'),
    raw_sources       TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(raw_sources) AND json_type(raw_sources) = 'array'),
    sources           TEXT    NOT NULL CHECK (json_valid(sources) AND json_type(sources) = 'array'),
    report_text       TEXT    NOT NULL,
    citations         TEXT    CHECK (citations IS NULL OR (json_valid(citations) AND json_type(citations) = 'array')),
    takeaways         TEXT    CHECK (takeaways IS NULL OR (json_valid(takeaways) AND json_type(takeaways) = 'array')),
    follow_ups        TEXT    CHECK (follow_ups IS NULL OR (json_valid(follow_ups) AND json_type(follow_ups) = 'array')),
    consensus         TEXT    CHECK (consensus IS NULL OR (json_valid(consensus) AND json_type(consensus) = 'object')),
    latency_ms        INTEGER NOT NULL CHECK (latency_ms >= 0),
    token_stats       TEXT    CHECK (token_stats IS NULL OR (json_valid(token_stats) AND json_type(token_stats) = 'object')),
    llm_model         TEXT,
    source_count      INTEGER NOT NULL CHECK (source_count >= 0),
    char_count        INTEGER NOT NULL CHECK (char_count >= 0),
    cache_hit         INTEGER NOT NULL DEFAULT 0 CHECK (cache_hit IN (0, 1)),
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_search_history_created_at
    ON search_history (created_at DESC, id DESC);
