// 信源相关类型。字段可空性严格按 docs/接口设计.md §4.1：
// 「键存在、值可为 null」写成 `T | null`；raw 批次不含的键写成可选 `?`。

export type SourceCategory = "preprint" | "code" | "spec" | "docs" | "blog";
export type SearchEngine = "tavily" | "deepseek";

/** sources 事件 phase=raw 的精简信源（契约 §4.1「raw 含」列）。 */
export type RawSource = Readonly<{
  id: string;
  title: string;
  url: string;
  domain: string;
  faviconUrl: string | null;
  engine: SearchEngine;
  category: SourceCategory;
  categorySource: "rule" | "model";
  confidence: number | null;
  publishedAt: string | null;
}>;

export type SourceScores = Readonly<{
  relevance: number | null;
  authority: number | null;
  freshness: number | null;
  final: number | null;
  weights: Readonly<Record<string, number>>;
}>;

/** sources 事件 phase=ranked 的完整信源，也是历史快照里 sources 的元素。 */
export type SourceCard = RawSource &
  Readonly<{
    /** 引用编号 1..K，对应研报里的 [n]。ranked 一定有值。 */
    index: number | null;
    categoryRule: string;
    passage: string | null;
    passageTruncated: boolean | null;
    scores: SourceScores;
    engineSignals: Readonly<Record<string, number>>;
    matchedQueries: ReadonlyArray<number>;
    bibtex: string | null;
    pdfUrl: string | null;
  }>;
