import { describe, expect, it } from "vitest";
import type { DoneEvent, HistoryDetail, SseEvent, SourceCard, TraceEvent } from "@/types";
import type { SearchAction } from "../actions";
import { escapeAction, searchReducer } from "../reducer";
import { initialState, isReplayingCache, type SearchState } from "../state";

// ---- 构造辅助 ----

function run(actions: ReadonlyArray<SearchAction>, from: SearchState = initialState): SearchState {
  return actions.reduce(searchReducer, from);
}

const ev = (runId: number, event: SseEvent): SearchAction => ({ type: "STREAM_EVENT", runId, event });
const token = (runId: number, delta: string) => ev(runId, { type: "token", data: { delta } });

function trace(
  step: TraceEvent["step"],
  status: TraceEvent["status"],
  elapsedMs: number | null,
  detail: TraceEvent["detail"] = null,
): SseEvent {
  return { type: "trace", data: { step, status, atMs: 0, elapsedMs, message: "", detail, cacheHit: false } };
}

function card(index: number): SourceCard {
  return {
    id: `src_${index}`,
    index,
    title: `t${index}`,
    url: `https://e${index}.com/`,
    domain: `e${index}.com`,
    faviconUrl: null,
    engine: "tavily",
    category: "blog",
    categorySource: "rule",
    categoryRule: "default",
    confidence: null,
    publishedAt: null,
    passage: null,
    passageTruncated: null,
    scores: { relevance: 1, authority: 1, freshness: null, final: 1, weights: {} },
    engineSignals: {},
    matchedQueries: [0],
    bibtex: null,
    pdfUrl: null,
  };
}

const DONE: DoneEvent = {
  historyId: "hist_1",
  latencyMs: 1234,
  stageTimings: { rewritingMs: 1, searchingMs: 2, reasoningMs: 3, generatingMs: 4, finalizingMs: 5 },
  firstTokenMs: 10,
  tokenStats: null,
  citations: [{ index: 1, markerStart: 0, markerEnd: 3, sentenceStart: 0, sentenceEnd: 3, highlight: null }],
  takeaways: [{ text: "要点", citations: [1] }],
  consensus: { score: 0.5, supportedSentences: 1, citedSentences: 2 },
  engine: "tavily",
  enginesUsed: ["tavily"],
  degraded: false,
  sourceCount: 2,
  charCount: 10,
  cacheHit: false,
};

/** 提交后收到第一个 token：进入 result 且生成中 */
function generating(): SearchState {
  const submitted = searchReducer(initialState, { type: "SUBMIT", query: "问题" });
  return run([
    ev(submitted.runId, { type: "sources", data: { phase: "ranked", engine: "tavily", queryIndex: null, items: [card(2), card(1)] } }),
    token(submitted.runId, "第一段"),
    token(submitted.runId, " [1]"),
  ], submitted);
}

const DETAIL: HistoryDetail = {
  id: "hist_9",
  query: "历史问题",
  focusMode: "web",
  engine: "tavily",
  enginesUsed: ["tavily"],
  degraded: false,
  scopeFilters: [],
  rewrittenQueries: ["q1", "q2"],
  stageTimings: DONE.stageTimings,
  traceEvents: [],
  sources: [card(2), card(1)],
  report: "历史正文 [1]",
  citations: DONE.citations,
  takeaways: null,
  followUps: ["追问一"],
  consensus: null,
  latencyMs: 999,
  tokenStats: null,
  llmModel: "m",
  sourceCount: 2,
  charCount: 6,
  cacheHit: false,
  createdAt: "2026-11-06T00:00:00.000Z",
  updatedAt: "2026-11-06T00:00:00.000Z",
};

describe("提交与进入 retrieving", () => {
  it("initial -> retrieving，保留问题，runId 前进", () => {
    const s = searchReducer(initialState, { type: "SUBMIT", query: "  问题  " });
    expect(s.phase).toBe("retrieving");
    expect(s.query).toBe("问题");
    expect(s.draft).toBe("问题");
    expect(s.runId).toBe(initialState.runId + 1);
  });

  it("空问题不触发状态切换", () => {
    expect(searchReducer(initialState, { type: "SUBMIT", query: "   " })).toBe(initialState);
  });

  it("新检索清空上一次的结果、轨迹和信源", () => {
    const old = run([
      { type: "SUBMIT", query: "旧" },
      ev(1, trace("rewriting", "end", 10, { queries: ["a"] })),
      ev(1, { type: "sources", data: { phase: "ranked", engine: "tavily", queryIndex: null, items: [card(1)] } }),
      token(1, "旧正文"),
      ev(1, { type: "done", data: DONE }),
    ]);
    expect(old.report).toBe("旧正文");
    const next = searchReducer(old, { type: "SUBMIT", query: "新" });
    expect(next.phase).toBe("retrieving");
    expect(next.report).toBe("");
    expect(next.sources).toEqual([]);
    expect(next.rawSources).toEqual([]);
    expect(next.rewrittenQueries).toEqual([]);
    expect(next.citations).toEqual([]);
    expect(next.latencyMs).toBeNull();
    expect(next.steps.rewriting.status).toBe("idle");
    expect(next.generating).toBe(false);
    expect(next.runId).toBe(old.runId + 1);
  });
});

describe("事件到 store 的映射", () => {
  it("trace：耗时只信 elapsedMs；rewriting end 展开改写词", () => {
    const s = run([
      { type: "SUBMIT", query: "q" },
      ev(1, trace("rewriting", "start", null)),
      ev(1, trace("rewriting", "end", 805, { queries: ["a", "b"], fallback: false, fallbackCode: null })),
      ev(1, trace("searching", "start", null, { engine: "tavily", queryCount: 2 })),
    ]);
    expect(s.steps.rewriting).toMatchObject({ status: "done", elapsedMs: 805 });
    expect(s.rewrittenQueries).toEqual(["a", "b"]);
    expect(s.steps.searching).toMatchObject({ status: "running", elapsedMs: null });
  });

  it("trace degraded：记下降级信息，状态仍是进行中", () => {
    const s = run([
      { type: "SUBMIT", query: "q" },
      ev(1, trace("searching", "start", null)),
      ev(1, trace("searching", "degraded", null, { from: "tavily", to: "deepseek", code: 50201, queryIndex: 0 })),
    ]);
    expect(s.steps.searching.status).toBe("running");
    expect(s.steps.searching.degraded).toEqual({ from: "tavily", to: "deepseek" });
  });

  it("sources raw：按 id 去重追加；ranked：整体替换并按 index 升序", () => {
    const raw = (ids: number[]): SseEvent => ({
      type: "sources",
      data: { phase: "raw", engine: "tavily", queryIndex: 0, items: ids.map(card) },
    });
    const s = run([{ type: "SUBMIT", query: "q" }, ev(1, raw([1, 2])), ev(1, raw([2, 3]))]);
    expect(s.rawSources.map((x) => x.id)).toEqual(["src_1", "src_2", "src_3"]);
    const ranked = run(
      [ev(1, { type: "sources", data: { phase: "ranked", engine: "tavily", queryIndex: null, items: [card(3), card(1), card(2)] } })],
      s,
    );
    expect(ranked.sources.map((x) => x.index)).toEqual([1, 2, 3]);
  });

  it("token 累计追加；相关追问、要点等先存起来", () => {
    const s = generating();
    expect(s.report).toBe("第一段 [1]");
    const withRelated = run([ev(s.runId, { type: "related", data: { items: ["a", "b", "c"] } })], s);
    expect(withRelated.related).toEqual(["a", "b", "c"]);
  });

  it("done：generating=false，记录 citations / 耗时 / 要点 / 共识度，并让历史版本号前进", () => {
    const g = generating();
    const s = searchReducer(g, ev(g.runId, { type: "done", data: DONE }));
    expect(s.phase).toBe("result");
    expect(s.generating).toBe(false);
    expect(s.citations).toEqual(DONE.citations);
    expect(s.latencyMs).toBe(1234);
    expect(s.stageTimings).toEqual(DONE.stageTimings);
    expect(s.takeaways).toEqual(DONE.takeaways);
    expect(s.consensus).toEqual(DONE.consensus);
    expect(s.historyId).toBe("hist_1");
    expect(s.historyVersion).toBe(g.historyVersion + 1);
  });
});

describe("状态流转：retrieving", () => {
  it("收到第一个 token：retrieving -> result，generating=true", () => {
    const submitted = searchReducer(initialState, { type: "SUBMIT", query: "q" });
    const s = searchReducer(submitted, token(submitted.runId, "你"));
    expect(s.phase).toBe("result");
    expect(s.generating).toBe(true);
    expect(s.report).toBe("你");
  });

  it("Esc / 停止：retrieving -> initial，输入框保留原问题", () => {
    const submitted = searchReducer(initialState, { type: "SUBMIT", query: "保留我" });
    const s = searchReducer(submitted, { type: "ABORT" });
    expect(s.phase).toBe("initial");
    expect(s.draft).toBe("保留我");
    expect(s.rawSources).toEqual([]);
    expect(s.runId).toBe(submitted.runId + 1);
  });

  it("连接出错：retrieving -> initial，输入框保留问题，显示提示条", () => {
    const submitted = searchReducer(initialState, { type: "SUBMIT", query: "q" });
    const s = searchReducer(submitted, {
      type: "STREAM_FAILURE",
      runId: submitted.runId,
      failure: { kind: "network", code: null, status: null, message: "x" },
    });
    expect(s.phase).toBe("initial");
    expect(s.draft).toBe("q");
    expect(s.error).toMatchObject({ retryable: true });
    expect(s.error?.title).toContain("连接失败");
  });

  it("retrieving 阶段收到 error 事件：回 initial", () => {
    const submitted = searchReducer(initialState, { type: "SUBMIT", query: "q" });
    const s = searchReducer(
      submitted,
      ev(submitted.runId, {
        type: "error",
        data: { code: 50201, message: "检索失败", step: "searching", retryable: true, upstream: "tavily" },
      }),
    );
    expect(s.phase).toBe("initial");
    expect(s.error).toMatchObject({ title: "检索失败", retryable: true, code: 50201 });
  });

  it("40001 校验错误：不可重试", () => {
    const submitted = searchReducer(initialState, { type: "SUBMIT", query: "q" });
    const s = searchReducer(submitted, {
      type: "STREAM_FAILURE",
      runId: submitted.runId,
      failure: { kind: "api", code: 40001, status: 400, message: "query 不合法" },
    });
    expect(s.error).toMatchObject({ retryable: false, code: 40001 });
  });
});

describe("状态流转：result", () => {
  it("生成中 Esc：留在 result，保留已生成内容并标注已中止", () => {
    const g = generating();
    const s = searchReducer(g, { type: "ABORT" });
    expect(s.phase).toBe("result");
    expect(s.generating).toBe(false);
    expect(s.aborted).toBe(true);
    expect(s.report).toBe("第一段 [1]");
    expect(s.sources).toHaveLength(2);
  });

  it("已完成时 ABORT 不改变状态", () => {
    const g = generating();
    const done = searchReducer(g, ev(g.runId, { type: "done", data: DONE }));
    expect(searchReducer(done, { type: "ABORT" })).toBe(done);
  });

  it("生成中途 error：留在 result，保留内容，标红出错阶段，可重试", () => {
    const g = generating();
    const running = run([ev(g.runId, trace("generating", "start", null))], g);
    const s = searchReducer(
      running,
      ev(g.runId, {
        type: "error",
        data: { code: 50202, message: "模型中断", step: "generating", retryable: true, upstream: "llm" },
      }),
    );
    expect(s.phase).toBe("result");
    expect(s.generating).toBe(false);
    expect(s.report).toBe("第一段 [1]");
    expect(s.error).toMatchObject({ retryable: true, title: "模型中断" });
    expect(s.steps.generating.status).toBe("failed");
  });

  it("流被关闭但没有 done：生成中算异常；已完成则忽略", () => {
    const g = generating();
    const closed = searchReducer(g, { type: "STREAM_CLOSED", runId: g.runId });
    expect(closed.phase).toBe("result");
    expect(closed.error?.retryable).toBe(true);
    const done = searchReducer(g, ev(g.runId, { type: "done", data: DONE }));
    expect(searchReducer(done, { type: "STREAM_CLOSED", runId: done.runId })).toBe(done);
  });

  it("result 内提交新问题：-> retrieving，旧数据清空", () => {
    const g = generating();
    const s = searchReducer(g, { type: "SUBMIT", query: "新问题" });
    expect(s.phase).toBe("retrieving");
    expect(s.report).toBe("");
    expect(s.sources).toEqual([]);
  });

  it("新检索 / 点击品牌：-> initial 并清空", () => {
    const s = searchReducer(generating(), { type: "NEW_SEARCH" });
    expect(s.phase).toBe("initial");
    expect(s.report).toBe("");
    expect(s.draft).toBe("");
  });
});

describe("迟到事件", () => {
  it("中止后迟到的 token / done / error 全部丢弃", () => {
    const g = generating();
    const aborted = searchReducer(g, { type: "ABORT" });
    const late = run(
      [
        token(g.runId, "迟到"),
        ev(g.runId, { type: "done", data: DONE }),
        ev(g.runId, { type: "error", data: { code: 1, message: "x", step: null, retryable: false, upstream: null } }),
        { type: "STREAM_FAILURE", runId: g.runId, failure: { kind: "network", code: null, status: null, message: "x" } },
        { type: "STREAM_CLOSED", runId: g.runId },
      ],
      aborted,
    );
    expect(late).toBe(aborted);
    expect(late.report).toBe("第一段 [1]");
    expect(late.error).toBeNull();
  });

  it("检索阶段中止后，迟到的事件不会把界面拉回 retrieving / result", () => {
    const submitted = searchReducer(initialState, { type: "SUBMIT", query: "q" });
    const aborted = searchReducer(submitted, { type: "ABORT" });
    const late = run([token(submitted.runId, "迟到"), ev(submitted.runId, trace("rewriting", "end", 5))], aborted);
    expect(late.phase).toBe("initial");
    expect(late.report).toBe("");
  });

  it("重新提交后，旧连接的事件被丢弃", () => {
    const first = searchReducer(initialState, { type: "SUBMIT", query: "一" });
    const second = searchReducer(first, { type: "SUBMIT", query: "二" });
    const late = searchReducer(second, token(first.runId, "旧连接的正文"));
    expect(late).toBe(second);
  });

  it("恢复历史后，旧连接的事件被丢弃", () => {
    const g = generating();
    const restored = searchReducer(g, { type: "RESTORE", detail: DETAIL });
    expect(searchReducer(restored, token(g.runId, "迟到"))).toBe(restored);
  });
});

describe("恢复历史", () => {
  it("任意状态 -> result，不处于生成中，还原正文 / 信源 / 引用 / 耗时", () => {
    for (const from of [initialState, searchReducer(initialState, { type: "SUBMIT", query: "q" }), generating()]) {
      const s = searchReducer(from, { type: "RESTORE", detail: DETAIL });
      expect(s.phase).toBe("result");
      expect(s.generating).toBe(false);
      expect(s.report).toBe("历史正文 [1]");
      expect(s.sources.map((x) => x.index)).toEqual([1, 2]);
      expect(s.citations).toEqual(DETAIL.citations);
      expect(s.latencyMs).toBe(999);
      expect(s.steps.generating).toMatchObject({ status: "done", elapsedMs: 4 });
      expect(s.rewrittenQueries).toEqual(["q1", "q2"]);
      expect(s.related).toEqual(["追问一"]);
      expect(s.historyId).toBe("hist_9");
      expect(s.restoredFromHistory).toBe(true);
    }
  });

  it("stageTimings 缺失时不伪造耗时", () => {
    const s = searchReducer(initialState, { type: "RESTORE", detail: { ...DETAIL, stageTimings: {} } });
    expect(s.stageTimings).toBeNull();
    expect(s.steps.rewriting.elapsedMs).toBeNull();
  });
});

describe("证据抽屉与 Esc 决策", () => {
  it("点击角标：打开抽屉，nonce 每次递增（同一个角标连点也能再次定位）", () => {
    const g = generating();
    const a = searchReducer(g, { type: "OPEN_CITATION", index: 2, markerStart: 7 });
    const b = searchReducer(a, { type: "OPEN_CITATION", index: 2, markerStart: 7 });
    expect(a.drawerOpen).toBe(true);
    expect(a.activeCitation).toEqual({ index: 2, markerStart: 7, nonce: 1 });
    expect(b.activeCitation).toEqual({ index: 2, markerStart: 7, nonce: 2 });
  });

  it("escapeAction 三种行为", () => {
    const submitted = searchReducer(initialState, { type: "SUBMIT", query: "q" });
    expect(escapeAction(initialState)).toBe("none");
    expect(escapeAction(submitted)).toBe("abort");

    const g = generating();
    const withDrawer = searchReducer(g, { type: "OPEN_CITATION", index: 1, markerStart: null });
    // 生成中：Esc 是停止，哪怕抽屉开着
    expect(escapeAction(withDrawer)).toBe("abort");

    const done = searchReducer(withDrawer, ev(g.runId, { type: "done", data: DONE }));
    expect(escapeAction(done)).toBe("close-drawer");
    expect(escapeAction(searchReducer(done, { type: "CLOSE_DRAWER" }))).toBe("none");
  });

  it("只有三个生命周期状态", () => {
    const phases = new Set<string>();
    let s = initialState;
    const steps: SearchAction[] = [
      { type: "SUBMIT", query: "q" },
      token(1, "x"),
      { type: "ABORT" },
      { type: "NEW_SEARCH" },
      { type: "RESTORE", detail: DETAIL },
    ];
    for (const action of steps) {
      s = searchReducer(s, action);
      phases.add(s.phase);
    }
    expect([...phases].every((p) => ["initial", "retrieving", "result"].includes(p))).toBe(true);
  });
});

describe("缓存命中标注（F20）", () => {
  const cachedTrace = (step: TraceEvent["step"], status: TraceEvent["status"], elapsedMs: number | null): SseEvent => ({
    type: "trace",
    data: { step, status, atMs: 0, elapsedMs, message: "", detail: null, cacheHit: true },
  });

  it("trace.cacheHit 记到对应阶段；耗时照用事件里的 elapsedMs，不改写", () => {
    const s = run([
      { type: "SUBMIT", query: "q" },
      ev(1, cachedTrace("rewriting", "start", null)),
      ev(1, cachedTrace("rewriting", "end", 3)),
      ev(1, trace("searching", "start", null)),
    ]);
    expect(s.steps.rewriting).toMatchObject({ cacheHit: true, elapsedMs: 3 });
    expect(s.steps.searching.cacheHit).toBe(false);
  });

  it("isReplayingCache：已开始的阶段全部命中才算回放；只有部分命中不算", () => {
    const all = run([
      { type: "SUBMIT", query: "q" },
      ev(1, cachedTrace("rewriting", "start", null)),
      ev(1, cachedTrace("rewriting", "end", 1)),
      ev(1, cachedTrace("searching", "start", null)),
    ]);
    expect(isReplayingCache(all.steps)).toBe(true);
    const partial = run(
      [ev(1, trace("reasoning", "start", null))],
      all,
    );
    expect(isReplayingCache(partial.steps)).toBe(false);
    expect(isReplayingCache(initialState.steps)).toBe(false);
  });

  it("done.cacheHit 决定整次结果；没有命中时为 false", () => {
    const g = generating();
    expect(searchReducer(g, ev(g.runId, { type: "done", data: { ...DONE, cacheHit: true, latencyMs: 12 } })).cacheHit).toBe(true);
    const miss = searchReducer(g, ev(g.runId, { type: "done", data: DONE }));
    expect(miss.cacheHit).toBe(false);
    expect(miss.latencyMs).toBe(1234);
  });

  it("新检索清掉上一次的缓存标记", () => {
    const g = generating();
    const hit = searchReducer(g, ev(g.runId, { type: "done", data: { ...DONE, cacheHit: true } }));
    expect(searchReducer(hit, { type: "SUBMIT", query: "新" }).cacheHit).toBe(false);
  });

  it("历史快照：有 cacheHit 字段就还原，缺失就不显示，不猜", () => {
    expect(searchReducer(initialState, { type: "RESTORE", detail: { ...DETAIL, cacheHit: true } }).cacheHit).toBe(true);
    expect(searchReducer(initialState, { type: "RESTORE", detail: { ...DETAIL, cacheHit: false } }).cacheHit).toBe(false);
    const missing = Object.fromEntries(Object.entries(DETAIL).filter(([key]) => key !== "cacheHit"));
    expect(searchReducer(initialState, { type: "RESTORE", detail: missing as unknown as HistoryDetail }).cacheHit).toBe(false);
  });
});
