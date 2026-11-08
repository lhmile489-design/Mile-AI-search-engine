import type {
  Citation,
  Consensus,
  DoneEvent,
  HistoryDetail,
  RawSource,
  SourceCard,
  StageTimings,
  StepName,
  Takeaway,
  TokenStats,
} from "@/types";
import { STEP_ORDER } from "@/types";

// 全局状态：界面只有 initial / retrieving / result 三态（PRODUCT.md §3）。
// result 内用 generating 区分「生成中」和「已完成」，不新增第四个状态。

export type SearchLifecycleState = "initial" | "retrieving" | "result";

export type StepStatus = "idle" | "running" | "done" | "failed";

export type StepState = Readonly<{
  status: StepStatus;
  /** 只信后端 trace.elapsedMs，前端不自己计时 */
  elapsedMs: number | null;
  /** 降级标注：searching tavily -> deepseek 等 */
  degraded: Readonly<{ from: string; to: string }> | null;
  /** trace.detail 原样保留，展示层按 step 读取 */
  detail: Readonly<Record<string, unknown>> | null;
}>;

/** 提示条内容：原因 + 下一步（PRODUCT.md §8），retryable 决定是否显示「重试」 */
export type UiError = Readonly<{
  title: string;
  hint: string;
  retryable: boolean;
  code: number | null;
  step: StepName | "finalizing" | null;
}>;

export type SearchState = Readonly<{
  phase: SearchLifecycleState;
  /** 输入框当前内容；检索中止或失败回到 initial 时保留 */
  draft: string;
  /** 本次检索（或恢复的历史）对应的问题 */
  query: string;
  /** 每次提交 / 中止 / 恢复 +1。流事件携带发起时的 runId，不匹配就丢弃（迟到事件） */
  runId: number;

  steps: Readonly<Record<StepName, StepState>>;
  rewrittenQueries: ReadonlyArray<string>;
  rawSources: ReadonlyArray<RawSource>;
  sources: ReadonlyArray<SourceCard>;

  report: string;
  generating: boolean;
  aborted: boolean;
  error: UiError | null;

  // done / 快照里的结果数据。related、takeaways、consensus、tokenStats 本轮只存不渲染（M5 使用）
  citations: ReadonlyArray<Citation>;
  latencyMs: number | null;
  stageTimings: StageTimings | null;
  historyId: string | null;
  related: ReadonlyArray<string>;
  takeaways: ReadonlyArray<Takeaway> | null;
  consensus: Consensus | null;
  tokenStats: TokenStats | null;
  done: DoneEvent | null;
  restoredFromHistory: boolean;
  /** 每次 done 或删除历史后 +1，历史侧边栏据此刷新 */
  historyVersion: number;

  // 证据抽屉
  drawerOpen: boolean;
  /** nonce 每次点击 +1，同一个角标连点也能重新触发滚动 */
  activeCitation: Readonly<{ index: number; nonce: number }> | null;
}>;

const IDLE_STEP: StepState = { status: "idle", elapsedMs: null, degraded: null, detail: null };

export function createIdleSteps(): Record<StepName, StepState> {
  const steps = {} as Record<StepName, StepState>;
  for (const name of STEP_ORDER) steps[name] = IDLE_STEP;
  return steps;
}

export const initialState: SearchState = {
  phase: "initial",
  draft: "",
  query: "",
  runId: 0,
  steps: createIdleSteps(),
  rewrittenQueries: [],
  rawSources: [],
  sources: [],
  report: "",
  generating: false,
  aborted: false,
  error: null,
  citations: [],
  latencyMs: null,
  stageTimings: null,
  historyId: null,
  related: [],
  takeaways: null,
  consensus: null,
  tokenStats: null,
  done: null,
  restoredFromHistory: false,
  historyVersion: 0,
  drawerOpen: false,
  activeCitation: null,
};

/** 清空一次检索产生的全部数据（进入 retrieving、新检索、恢复历史前都要做）。 */
export function clearRun(state: SearchState): SearchState {
  return {
    ...state,
    steps: createIdleSteps(),
    rewrittenQueries: [],
    rawSources: [],
    sources: [],
    report: "",
    generating: false,
    aborted: false,
    error: null,
    citations: [],
    latencyMs: null,
    stageTimings: null,
    historyId: null,
    related: [],
    takeaways: null,
    consensus: null,
    tokenStats: null,
    done: null,
    restoredFromHistory: false,
    drawerOpen: false,
    activeCitation: null,
  };
}

export type { HistoryDetail };
