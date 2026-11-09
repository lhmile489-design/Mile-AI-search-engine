import type { RawSource, SourceCard } from "./source";

// SSE 六类事件载荷，对应 docs/接口设计.md §3。

export type StepName = "rewriting" | "searching" | "reasoning" | "generating";
export const STEP_ORDER: ReadonlyArray<StepName> = ["rewriting", "searching", "reasoning", "generating"];
export type TraceStatus = "start" | "end" | "degraded";

export type TraceEvent = Readonly<{
  step: StepName;
  status: TraceStatus;
  atMs: number;
  /** 只在 status=end 时有值 */
  elapsedMs: number | null;
  message: string;
  /** 结构随 step + status 变化（§3.1 表），读取时按需断言 */
  detail: Readonly<Record<string, unknown>> | null;
  cacheHit: boolean;
}>;

export type SourcesEvent =
  | Readonly<{ phase: "raw"; engine: string; queryIndex: number | null; items: ReadonlyArray<RawSource> }>
  | Readonly<{ phase: "ranked"; engine: string; queryIndex: null; items: ReadonlyArray<SourceCard> }>;

export type TokenEvent = Readonly<{ delta: string }>;
export type RelatedEvent = Readonly<{ items: ReadonlyArray<string> }>;

export type HighlightRange = Readonly<{
  /** 被引源 passage 内的 UTF-16 码元偏移，可直接 slice */
  start: number;
  end: number;
  score: number;
}>;

export type Citation = Readonly<{
  index: number;
  markerStart: number;
  markerEnd: number;
  sentenceStart: number;
  sentenceEnd: number;
  highlight: HighlightRange | null;
}>;

export type StageTimings = Readonly<{
  rewritingMs: number;
  searchingMs: number;
  reasoningMs: number;
  generatingMs: number;
  finalizingMs: number;
}>;

export type TokenStats = Readonly<{
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  calls: number;
}>;

export type Takeaway = Readonly<{ text: string; citations: ReadonlyArray<number> }>;

export type Consensus = Readonly<{
  score: number | null;
  supportedSentences: number;
  citedSentences: number;
}>;

export type DoneEvent = Readonly<{
  historyId: string | null;
  latencyMs: number;
  stageTimings: StageTimings;
  firstTokenMs: number | null;
  tokenStats: TokenStats | null;
  citations: ReadonlyArray<Citation>;
  takeaways: ReadonlyArray<Takeaway> | null;
  consensus: Consensus | null;
  engine: string;
  enginesUsed: ReadonlyArray<string>;
  degraded: boolean;
  sourceCount: number;
  charCount: number;
  cacheHit: boolean;
}>;

export type ErrorEvent = Readonly<{
  code: number;
  message: string;
  step: StepName | "finalizing" | null;
  retryable: boolean;
  upstream: string | null;
}>;

/** 解析后的带类型事件。未知事件名在 parseSseEvent 里丢弃，不会出现在这里。 */
export type SseEvent =
  | Readonly<{ type: "trace"; data: TraceEvent }>
  | Readonly<{ type: "sources"; data: SourcesEvent }>
  | Readonly<{ type: "token"; data: TokenEvent }>
  | Readonly<{ type: "related"; data: RelatedEvent }>
  | Readonly<{ type: "done"; data: DoneEvent }>
  | Readonly<{ type: "error"; data: ErrorEvent }>;

export type SseEventName = SseEvent["type"];
export const SSE_EVENT_NAMES: ReadonlyArray<SseEventName> = [
  "trace",
  "sources",
  "token",
  "related",
  "done",
  "error",
];
