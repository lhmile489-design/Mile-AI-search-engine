import { useState } from "react";
import { Activity, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatMs } from "@/lib/format";
import type { SearchState } from "@/store/state";
import { STEP_ORDER } from "@/types";
import { stepSummary } from "./HeronStepper";

// F24：推理摘要折叠块，对齐 UI 改版稿 .steps-block（「检索过程」）。
// 收起：总耗时 · 阶段完成数；展开：各阶段状态圆点 + 补充说明 + 耗时。
// 数字全部来自 trace 和 done，缓存回放时也是本次真实值。

const STEP_LABEL: Readonly<Record<string, string>> = {
  rewriting: "改写检索词",
  searching: "检索",
  reasoning: "分类重排",
  generating: "生成研报",
};

export type StageSummaryBarProps = Readonly<{
  state: SearchState;
}>;

export function StageSummaryBar({ state }: StageSummaryBarProps) {
  const [open, setOpen] = useState(false);
  const doneCount = STEP_ORDER.filter((name) => state.steps[name].status === "done").length;
  const latency = state.latencyMs;

  return (
    <div className="steps-block">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="steps-block-header">
        <span className="steps-block-title">
          <Activity size={14} aria-hidden="true" />
          检索过程
        </span>
        <span className="steps-block-toggle">
          {latency !== null ? <span className="font-mono">{formatMs(latency)}</span> : null}
          {latency !== null ? " · " : ""}
          {doneCount}/{STEP_ORDER.length} 步完成
          {open ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        </span>
      </button>
      {open ? (
        <ol className="steps-list">
          {STEP_ORDER.map((name) => {
            const step = state.steps[name];
            const summary = stepSummary(name, step);
            return (
              <li key={name} className="step-row">
                <span className={cn("step-dot", step.status)} aria-hidden="true" />
                <span className="min-w-0 truncate">
                  {STEP_LABEL[name]}
                  {summary ? <span className="text-ink-faint">（{summary}）</span> : null}
                  {step.cacheHit ? <span className="ml-1 text-accent-soft-ink">缓存</span> : null}
                </span>
                <span className="step-time">{step.elapsedMs !== null ? formatMs(step.elapsedMs) : "—"}</span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}
