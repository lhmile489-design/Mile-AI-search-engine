import type {
  Citation,
  Consensus,
  StageTimings,
  Takeaway,
  TokenStats,
} from "./events";
import type { SourceCard, SourceCategory } from "./source";

// 非流式接口类型，对应 docs/接口设计.md §2.1、§13。

export type FocusMode = "academic" | "code" | "web";

export type SearchRequest = Readonly<{
  query: string;
  focusMode: FocusMode;
  engine: string;
  scopeFilters: ReadonlyArray<SourceCategory>;
}>;

export type ApiEnvelope<T> = Readonly<{ code: number; msg: string; data: T }>;

// 后端 /api/config 实际返回的元素形态（M2 实现）：{value, label, ...}
export type ConfigOption = Readonly<{ value: string; label: string; description?: string }>;
export type EngineOption = Readonly<{ value: string; label: string; available: boolean }>;

export type AppConfig = Readonly<{
  focusModes: ReadonlyArray<ConfigOption>;
  engines: ReadonlyArray<EngineOption>;
  scopes: ReadonlyArray<ConfigOption>;
  version: string;
}>;

export type SuggestionsData = Readonly<{ items: ReadonlyArray<string> }>;

export type HistoryCard = Readonly<{
  id: string;
  query: string;
  focusMode: FocusMode;
  engine: string;
  createdAt: string;
  sourceCount: number;
  charCount: number;
  latencyMs: number;
  cacheHit: boolean;
}>;

export type HistoryList = Readonly<{ total: number; records: ReadonlyArray<HistoryCard> }>;

/** GET /api/history/{id}：完整快照（契约 §13.3，字段以 backend/app/db 的 _row_to_detail 为准） */
export type HistoryDetail = Readonly<{
  id: string;
  query: string;
  focusMode: FocusMode;
  engine: string;
  enginesUsed: ReadonlyArray<string>;
  degraded: boolean;
  scopeFilters: ReadonlyArray<string>;
  rewrittenQueries: ReadonlyArray<string>;
  stageTimings: StageTimings | Readonly<Record<string, never>>;
  traceEvents: ReadonlyArray<unknown>;
  sources: ReadonlyArray<SourceCard>;
  report: string | null;
  citations: ReadonlyArray<Citation>;
  takeaways: ReadonlyArray<Takeaway> | null;
  followUps: ReadonlyArray<string> | null;
  consensus: Consensus | null;
  latencyMs: number;
  tokenStats: TokenStats | null;
  llmModel: string | null;
  sourceCount: number;
  charCount: number;
  cacheHit: boolean;
  createdAt: string;
  updatedAt: string;
}>;
