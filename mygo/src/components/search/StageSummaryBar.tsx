
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatMs } from "@/lib/format";
import type { SearchState } from "@/store/state";
import { STEP_ORDER } from "@/types";

// F24：结果页顶部常驻的推理摘要折叠条。
// 收起：阶段完成数 · 总耗时 · 信源数；展开：简版时间轴（各阶段状态 + 耗时）。
// 数字全部来自 trace 和 done，缓存回放时也是本次真实值。

const STEP_LABEL: Readonly<Record<string, string>> = {
  rewriting: "改写检索词",
  searching: "检索",
  reasoning: "分类重排",
  generating: "生成研报",
};

const DOT: Readonly<Record<string, string>> = {
  idle: "bg-ink-muted",
  running: "bg-accent",
  done: "bg-success",
  failed: "bg-danger",
};

export type StageSummaryBarProps = Readonly<{
  state: SearchState;
}>;

export function StageSummaryBar({ state }: StageSummaryBarProps) {
  const [open, setOpen] = useState(false);
  const doneCount = STEP_ORDER.filter((name) => state.steps[name].status === "done").length;
  const latency = state.latencyMs;

  return (
    <div className="rounded-card bg-surface shadow-e2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between gap-4 px-6 py-3 text-left"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="font-semibold text-ink">
            {doneCount}/{STEP_ORDER.length} 阶段完成
          </span>
          {latency !== null ? (
            <span className="font-mono tabular-nums text-ink-soft">{formatMs(latency)}</span>
          ) : null}
          <span className="text-ink-soft">{state.sources.length} 个信源</span>
        </div>
        {open ? (
          <ChevronUp size={18} aria-hidden="true" className="shrink-0 text-ink-soft" />
        ) : (
          <ChevronDown size={18} aria-hidden="true" className="shrink-0 text-ink-soft" />
        )}
      </button>
      {open ? (
        <ol className="border-t border-line px-6 pb-4 pt-3">
          {STEP_ORDER.map((name) => {
            const step = state.steps[name];
            return (
              <li key={name} className="flex items-center justify-between gap-4 py-1.5">
                <span className="flex items-center gap-2 text-sm text-ink">
                  <span className={cn("h-2 w-2 rounded-pill", DOT[step.status])} aria-hidden="true" />
                  {STEP_LABEL[name]}
                  {step.cacheHit ? (
                    <span className="rounded-pill bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-soft-ink">
                      缓存
                    </span>
                  ) : null}
                </span>
                <span className="font-mono text-sm tabular-nums text-ink-soft">
                  {step.elapsedMs !== null ? formatMs(step.elapsedMs) : "—"}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}
