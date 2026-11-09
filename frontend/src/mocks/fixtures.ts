import type { DoneEvent, RawSource, SourceCard, TraceEvent } from "@/types";

// 开发期 mock 数据。字段严格按 docs/接口设计.md v1.0，只用于真实后端不方便稳定复现的场景
// （生成中途 error、45 秒静默、带 [99] 幻觉角标的不完整正文）。
// 本目录只会被 src/lib/transport.ts 的开发期分支动态引入，生产构建不得引用。

function raw(id: string, domain: string, title: string, category: RawSource["category"]): RawSource {
  return {
    id,
    title,
    url: `https://${domain}/mock/${id}`,
    domain,
    faviconUrl: null,
    engine: "tavily",
    category,
    categorySource: "rule",
    confidence: null,
    publishedAt: "2025-08-27T00:00:00Z",
  };
}

export const MOCK_RAW: ReadonlyArray<RawSource> = [
  raw("src_mock00000001", "github.com", "Mock 信源一：代码仓库讨论", "code"),
  raw("src_mock00000002", "docs.example.org", "Mock 信源二：官方文档", "docs"),
  raw("src_mock00000003", "example.dev", "Mock 信源三：技术博客", "blog"),
];

const PASSAGES: ReadonlyArray<string> = [
  "这是第一段原文。FP8 内核在 Hopper 上的吞吐取决于张量核心的调度方式。后面还有一句补充说明。",
  "Second passage. TMA copies reduce register pressure. 这一句是中文，用来检查偏移。",
  "第三个信源没有高亮范围，只高亮卡片。",
];

export const MOCK_RANKED: ReadonlyArray<SourceCard> = MOCK_RAW.map((source, i) => ({
  ...source,
  index: i + 1,
  categoryRule: "default",
  passage: PASSAGES[i] ?? null,
  passageTruncated: false,
  scores: { relevance: 0.8, authority: 0.5, freshness: null, final: 0.7, weights: { relevance: 0.7, authority: 0.3 } },
  engineSignals: { score: 0.8 },
  matchedQueries: [0],
  bibtex: null,
  pdfUrl: null,
}));

export function trace(
  step: TraceEvent["step"],
  status: TraceEvent["status"],
  atMs: number,
  elapsedMs: number | null,
  detail: TraceEvent["detail"] = null,
): TraceEvent {
  return { step, status, atMs, elapsedMs, message: "", detail, cacheHit: false };
}

/**
 * 按给定的研报正文生成 done 事件：citations 的 markerStart 取自正文里 [n] 的真实 UTF-16 下标，
 * 和后端的口径一致（偏移针对原始 report）。highlight 指向 PASSAGES 里写死的句子区间。
 */
export function buildDone(report: string): DoneEvent {
  const first = PASSAGES[0] ?? "";
  const second = first.indexOf("后面");
  const ranges: ReadonlyArray<{ start: number; end: number }> = [
    { start: first.indexOf("FP8"), end: second },
    { start: second, end: first.length },
  ];
  let seen = 0;
  const citations = [...report.matchAll(/\[(\d+)\]/g)]
    .filter((m) => Number(m[1]) >= 1 && Number(m[1]) <= MOCK_RANKED.length)
    .map((m) => {
      const index = Number(m[1]);
      const start = m.index ?? 0;
      // 只有信源 1 带高亮：第一个 [1] 指向第一句，第二个 [1] 指向第二句
      const range = index === 1 ? ranges[Math.min(seen++, ranges.length - 1)] : undefined;
      return {
        index,
        markerStart: start,
        markerEnd: start + m[0].length,
        sentenceStart: 0,
        sentenceEnd: start + m[0].length,
        highlight: range ? { ...range, score: 0.5 } : null,
      };
    });
  return {
    historyId: null,
    latencyMs: 4200,
    stageTimings: { rewritingMs: 800, searchingMs: 1200, reasoningMs: 50, generatingMs: 2000, finalizingMs: 150 },
    firstTokenMs: 300,
    tokenStats: null,
    citations,
    takeaways: null,
    consensus: null,
    engine: "tavily",
    enginesUsed: ["tavily"],
    degraded: false,
    sourceCount: MOCK_RANKED.length,
    charCount: report.length,
    cacheHit: false,
  };
}
