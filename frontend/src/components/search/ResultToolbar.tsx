import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { formatCount, formatMs } from "@/lib/format";

// 结果页顶部的问题标题与指标行（纯渲染，便于单测）。
// 耗时一律用后端下发的值：缓存回放时 latencyMs 也是本次回放的真实耗时，不隐藏、不改写。

export type ResultToolbarProps = Readonly<{
  query: string;
  generating: boolean;
  aborted: boolean;
  latencyMs: number | null;
  sourceCount: number;
  /** 本次是缓存回放：来自 done.cacheHit / 历史快照 / 各阶段 trace.cacheHit */
  cacheHit: boolean;
  restoredFromHistory: boolean;
  /** 右侧操作按钮区 */
  actions?: ReactNode;
}>;

function StatusTag({ tone, children }: Readonly<{ tone: "accent" | "warning"; children: string }>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill px-3 py-0.5 text-sm font-semibold",
        tone === "accent" ? "bg-accent-soft text-accent-soft-ink" : "bg-warning-soft text-warning",
      )}
    >
      {children}
    </span>
  );
}

export function ResultToolbar({
  query,
  generating,
  aborted,
  latencyMs,
  sourceCount,
  cacheHit,
  restoredFromHistory,
  actions,
}: ResultToolbarProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="w-full min-w-0 sm:w-auto sm:flex-1">
        <h1 className="break-words font-display text-xl font-bold leading-heading">{query}</h1>
        <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-soft">
          {generating ? (
            <li>
              <StatusTag tone="accent">生成中</StatusTag>
            </li>
          ) : aborted ? (
            <li>
              <StatusTag tone="warning">已中止</StatusTag>
            </li>
          ) : latencyMs !== null ? (
            <li>
              总耗时 <span className="font-mono tabular-nums text-ink">{formatMs(latencyMs)}</span>
            </li>
          ) : null}
          {cacheHit ? (
            <li>
              <Badge>缓存命中</Badge>
            </li>
          ) : null}
          <li>
            <span className="font-mono tabular-nums text-ink">{formatCount(sourceCount, "个信源")}</span>
          </li>
          {restoredFromHistory ? <li>来自历史记录</li> : null}
        </ul>
      </div>
      {actions}
    </div>
  );
}
