import type {
  HistoryDetail,
  RawSource,
  SourceCard,
  StageTimings,
  StepName,
  TraceEvent,
} from "@/types";
import { STEP_ORDER } from "@/types";
import type { SearchAction } from "./actions";
import { describeErrorEvent, describeStreamClosed, describeStreamFailure } from "./errors";
import {
  clearRun,
  createIdleSteps,
  initialState,
  type SearchState,
  type StepState,
  type UiError,
} from "./state";

// 单一 reducer：三态切换只在这里发生（PRODUCT.md §3.2）。
// 为什么只用一个 reducer：状态流转有大量「同一事件在不同状态下含义不同」的规则
// （Esc、error、token），分散在组件里很容易出现两个组件各改一半、界面处于不可能状态。

function updateStep(state: SearchState, name: StepName, patch: Partial<StepState>): SearchState {
  return { ...state, steps: { ...state.steps, [name]: { ...state.steps[name], ...patch } } };
}

function stringList(value: unknown): ReadonlyArray<string> {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function applyTrace(state: SearchState, trace: TraceEvent): SearchState {
  if (!STEP_ORDER.includes(trace.step)) return state;
  const detail = trace.detail ?? null;
  switch (trace.status) {
    case "start":
      return updateStep(state, trace.step, { status: "running", detail, cacheHit: trace.cacheHit === true });
    case "end": {
      // 耗时只信后端的 elapsedMs
      let next = updateStep(state, trace.step, {
        status: "done",
        elapsedMs: trace.elapsedMs,
        detail,
        cacheHit: trace.cacheHit === true,
      });
      if (trace.step === "rewriting") {
        next = { ...next, rewrittenQueries: stringList(detail?.queries) };
      }
      return next;
    }
    case "degraded": {
      const from = typeof detail?.from === "string" ? detail.from : "";
      const to = typeof detail?.to === "string" ? detail.to : "";
      const current = state.steps[trace.step];
      return updateStep(state, trace.step, {
        status: current.status === "idle" ? "running" : current.status,
        degraded: { from, to },
        cacheHit: current.cacheHit || trace.cacheHit === true,
      });
    }
  }
}

function appendRaw(existing: ReadonlyArray<RawSource>, items: ReadonlyArray<RawSource>): ReadonlyArray<RawSource> {
  const seen = new Set(existing.map((item) => item.id));
  const added = items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return added.length === 0 ? existing : [...existing, ...added];
}

function sortRanked(items: ReadonlyArray<SourceCard>): ReadonlyArray<SourceCard> {
  return [...items].sort((a, b) => (a.index ?? Number.MAX_SAFE_INTEGER) - (b.index ?? Number.MAX_SAFE_INTEGER));
}

/**
 * 流出错（error 事件 / 网络 / 看门狗 / 意外关闭）的两种落点（PRODUCT.md §3.1）：
 *  - retrieving：回 initial，输入框保留原问题，显示提示条
 *  - result：留在 result，保留已生成内容，显示提示条（可重试时带「重试」）
 */
function applyFailure(state: SearchState, error: UiError): SearchState {
  if (state.phase === "retrieving") {
    return { ...clearRun(state), phase: "initial", draft: state.query, runId: state.runId + 1, error };
  }
  if (state.phase === "result") {
    let next: SearchState = { ...state, generating: false, error };
    // 出错的阶段标红；没有 step 信息时，把仍在进行中的阶段标红
    const failedStep =
      error.step && error.step !== "finalizing"
        ? error.step
        : STEP_ORDER.find((name) => state.steps[name].status === "running");
    if (failedStep) next = updateStep(next, failedStep, { status: "failed" });
    return next;
  }
  return state;
}

function applyStreamEvent(state: SearchState, event: Extract<SearchAction, { type: "STREAM_EVENT" }>["event"]): SearchState {
  switch (event.type) {
    case "trace":
      return applyTrace(state, event.data);
    case "sources":
      if (event.data.phase === "raw") {
        return { ...state, rawSources: appendRaw(state.rawSources, event.data.items) };
      }
      // ranked：整体替换，分类以 ranked 为准
      return { ...state, sources: sortRanked(event.data.items) };
    case "token":
      // 第一个 token 到达：retrieving -> result，研报在屏幕 3 继续流式输出
      return {
        ...state,
        phase: "result",
        generating: true,
        report: state.report + event.data.delta,
      };
    case "related":
      return { ...state, related: event.data.items };
    case "done": {
      const done = event.data;
      return {
        ...state,
        phase: "result",
        generating: false,
        citations: done.citations,
        latencyMs: done.latencyMs,
        stageTimings: done.stageTimings,
        historyId: done.historyId,
        takeaways: done.takeaways,
        consensus: done.consensus,
        tokenStats: done.tokenStats,
        done,
        cacheHit: done.cacheHit === true,
        historyVersion: state.historyVersion + 1,
      };
    }
    case "error":
      return applyFailure(state, describeErrorEvent(event.data));
  }
}

const TIMING_KEYS: Readonly<Record<StepName, keyof StageTimings>> = {
  rewriting: "rewritingMs",
  searching: "searchingMs",
  reasoning: "reasoningMs",
  generating: "generatingMs",
};

function applySnapshot(state: SearchState, detail: HistoryDetail): SearchState {
  const timings = detail.stageTimings as Partial<StageTimings>;
  const steps = createIdleSteps();
  for (const name of STEP_ORDER) {
    const ms = timings[TIMING_KEYS[name]];
    if (typeof ms === "number") steps[name] = { status: "done", elapsedMs: ms, degraded: null, detail: null, cacheHit: false };
  }
  const hasTimings = typeof timings.rewritingMs === "number";
  return {
    ...clearRun(state),
    phase: "result",
    draft: detail.query,
    query: detail.query,
    runId: state.runId + 1,
    steps,
    rewrittenQueries: detail.rewrittenQueries ?? [],
    sources: sortRanked(detail.sources ?? []),
    report: detail.report ?? "",
    citations: detail.citations ?? [],
    latencyMs: detail.latencyMs,
    stageTimings: hasTimings ? (timings as StageTimings) : null,
    historyId: detail.id,
    related: detail.followUps ?? [],
    takeaways: detail.takeaways,
    consensus: detail.consensus,
    tokenStats: detail.tokenStats,
    // 快照里没有该字段就当作未命中，不猜
    cacheHit: detail.cacheHit === true,
    restoredFromHistory: true,
    historyVersion: state.historyVersion,
  };
}

export function searchReducer(state: SearchState, action: SearchAction): SearchState {
  switch (action.type) {
    case "DRAFT_CHANGED":
      return { ...state, draft: action.draft };

    case "SUBMIT": {
      const query = action.query.trim();
      if (!query) return state;
      // 进入 retrieving 前清空上一次的结果、轨迹和信源，避免新旧数据混在一起
      return {
        ...clearRun(state),
        phase: "retrieving",
        draft: query,
        query,
        runId: state.runId + 1,
      };
    }

    case "STREAM_EVENT":
    case "STREAM_FAILURE":
    case "STREAM_CLOSED": {
      // 迟到事件：中止 / 重新提交 / 恢复历史都会让 runId 前进
      if (action.runId !== state.runId || state.phase === "initial") return state;
      if (action.type === "STREAM_EVENT") return applyStreamEvent(state, action.event);
      if (action.type === "STREAM_FAILURE") return applyFailure(state, describeStreamFailure(action.failure));
      // 流被关闭但没有 done：只有仍在检索 / 生成中才算异常
      if (state.phase === "retrieving" || state.generating) return applyFailure(state, describeStreamClosed());
      return state;
    }

    case "ABORT": {
      if (state.phase === "retrieving") {
        // 检索阶段中止：回 initial，输入框保留原问题
        return { ...clearRun(state), phase: "initial", draft: state.query, runId: state.runId + 1 };
      }
      if (state.phase === "result" && state.generating) {
        // 生成阶段中止：留在 result，保留已生成内容并标注「已中止」
        return { ...state, generating: false, aborted: true, runId: state.runId + 1 };
      }
      return state;
    }

    case "NEW_SEARCH":
      return { ...clearRun(state), phase: "initial", draft: "", query: "", runId: state.runId + 1 };

    case "RESTORE":
      return applySnapshot(state, action.detail);

    case "OPEN_CITATION":
      if (state.phase !== "result") return state;
      return {
        ...state,
        drawerOpen: true,
        activeCitation: {
          index: action.index,
          markerStart: action.markerStart,
          nonce: (state.activeCitation?.nonce ?? 0) + 1,
        },
      };

    case "OPEN_DRAWER":
      return state.phase === "result" ? { ...state, drawerOpen: true } : state;

    case "CLOSE_DRAWER":
      return { ...state, drawerOpen: false };

    case "SHOW_ERROR":
      return { ...state, error: action.error };

    case "DISMISS_ERROR":
      return state.error ? { ...state, error: null } : state;

    case "HISTORY_CHANGED":
      return { ...state, historyVersion: state.historyVersion + 1 };

    case "SET_FOCUS_MODE":
      return { ...state, focusMode: action.focusMode };

    case "SET_SCOPE_FILTERS":
      return { ...state, scopeFilters: action.scopeFilters };

    case "SET_ENGINE":
      return { ...state, engine: action.engine };
  }
}

export type EscapeAction = "abort" | "close-drawer" | "none";

/** Esc 的三种行为（PRODUCT.md §6）：检索中 / 生成中停止；结果页已完成时关闭覆盖式抽屉；其余不处理。 */
export function escapeAction(state: SearchState): EscapeAction {
  if (state.phase === "retrieving" || (state.phase === "result" && state.generating)) return "abort";
  if (state.phase === "result" && state.drawerOpen) return "close-drawer";
  return "none";
}

export { initialState };
