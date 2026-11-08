import { cn } from "@/lib/cn";
import { formatMs } from "@/lib/format";
import type { StepName } from "@/types";
import { STEP_ORDER } from "@/types";
import { Badge } from "@/components/ui/Badge";
import { isReplayingCache, type SearchState, type StepState, type StepStatus } from "@/store/state";

// HeronStepper 步骤时间轴：DESIGN.md §7。四个阶段，每步显示状态与后端给出的毫秒耗时。

const LABELS: Readonly<Record<StepName, string>> = {
  rewriting: "改写检索词",
  searching: "检索",
  reasoning: "分类重排",
  generating: "生成研报",
};

const STATUS_TEXT: Readonly<Record<StepStatus, string>> = {
  idle: "等待中",
  running: "进行中",
  done: "已完成",
  failed: "失败",
};

const DOT: Readonly<Record<StepStatus, string>> = {
  idle: "bg-ink-muted",
  running: "bg-accent shadow-focus-soft",
  done: "bg-success",
  failed: "bg-danger",
};

const STATUS_COLOR: Readonly<Record<StepStatus, string>> = {
  idle: "text-ink-muted",
  running: "text-accent-deep",
  done: "text-success",
  failed: "text-danger",
};

function num(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/** 每个阶段的补充说明，字段来自 trace.detail（契约 §3.1 表），缺字段就不显示。 */
export function stepSummary(name: StepName, step: StepState): string | null {
  const d = step.detail;
  if (!d) return null;
  switch (name) {
    case "rewriting":
      if (step.status !== "done") return null;
      return d.fallback === true ? "改写失败，已改用原问题检索" : null;
    case "searching": {
      const parts: string[] = [];
      if (typeof d.engine === "string") parts.push(`引擎 ${d.engine}`);
      const queryCount = num(d.queryCount);
      if (queryCount !== null) parts.push(`${queryCount} 个检索词`);
      const rawCount = num(d.rawCount);
      if (rawCount !== null) parts.push(`原始结果 ${rawCount} 条`);
      if (Array.isArray(d.failedQueries) && d.failedQueries.length > 0) {
        parts.push(`${d.failedQueries.length} 个检索词失败`);
      }
      return parts.length > 0 ? parts.join(" · ") : null;
    }
    case "reasoning": {
      const deduped = num(d.dedupedCount);
      const filtered = num(d.filteredCount);
      const ranked = num(d.rankedCount);
      if (ranked === null) return null;
      const parts = [];
      if (deduped !== null) parts.push(`去重后 ${deduped} 条`);
      if (filtered !== null) parts.push(`过滤后 ${filtered} 条`);
      parts.push(`入选 ${ranked} 条`);
      return parts.join(" · ");
    }
    case "generating": {
      const parts: string[] = [];
      const count = num(d.sourceCount);
      if (count !== null) parts.push(`基于 ${count} 个信源`);
      if (typeof d.model === "string") parts.push(`模型 ${d.model}`);
      return parts.length > 0 ? parts.join(" · ") : null;
    }
  }
}

export type HeronStepperProps = Readonly<{
  steps: SearchState["steps"];
  rewrittenQueries: ReadonlyArray<string>;
}>;

export function HeronStepper({ steps, rewrittenQueries }: HeronStepperProps) {
  // 全部已开始的阶段都命中缓存 = 缓存回放；只有个别阶段命中（子检索词缓存）则由阶段自己标注
  const replay = isReplayingCache(steps);
  return (
    <section aria-label="检索进度" className="rounded-card bg-surface px-6 py-7 shadow-e2">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-lg font-bold">检索进度</h2>
        {replay ? <Badge>缓存命中</Badge> : null}
      </div>
      <ol className="mt-6 ml-1">
        {STEP_ORDER.map((name, i) => {
          const step = steps[name];
          const summary = stepSummary(name, step);
          const last = i === STEP_ORDER.length - 1;
          return (
            <li
              key={name}
              aria-current={step.status === "running" ? "step" : undefined}
              className={cn("relative border-l-2 border-line pl-6", last ? "pb-0" : "pb-6")}
            >
              <span
                aria-hidden="true"
                className={cn("absolute -left-1.5 top-1.5 h-2.5 w-2.5 rounded-pill", DOT[step.status])}
              />
              <div className="flex items-baseline justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-ui font-semibold text-ink">{LABELS[name]}</p>
                  <p className={cn("text-sm font-semibold", STATUS_COLOR[step.status])}>
                    {STATUS_TEXT[step.status]}
                    {step.cacheHit && !replay ? "（缓存命中）" : ""}
                  </p>
                </div>
                <p className="shrink-0 text-right font-mono text-sm tabular-nums text-ink-soft">
                  {step.elapsedMs !== null ? formatMs(step.elapsedMs) : ""}
                </p>
              </div>
              {summary ? <p className="mt-1 text-sm text-ink-soft">{summary}</p> : null}
              {step.degraded ? (
                <p className="mt-1 inline-block rounded-xs bg-warning-soft px-2 py-0.5 text-sm font-semibold text-warning">
                  已降级{step.degraded.from && step.degraded.to ? `：${step.degraded.from} 切换到 ${step.degraded.to}` : ""}
                </p>
              ) : null}
              {name === "rewriting" && rewrittenQueries.length > 0 ? (
                <ul className="mt-3 grid gap-2" aria-label="改写后的检索词">
                  {rewrittenQueries.map((q) => (
                    <li key={q} className="row-in rounded-md bg-surface-sunk px-3 py-2 font-mono text-sm text-ink break-words">
                      {q}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
