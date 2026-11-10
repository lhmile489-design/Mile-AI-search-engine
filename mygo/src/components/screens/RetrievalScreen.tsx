import { Square } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { HeronStepper } from "@/components/search/HeronStepper";
import { LiveSourceRadar } from "@/components/search/LiveSourceRadar";
import type { SearchState } from "@/store/state";

// 屏幕 2：检索推理态（PRODUCT.md §4.2）。对齐 UI 改版稿：顶部查询条，下方左步骤条、右 340px 信源雷达；
// 小于 1024px 上下排列。本屏不显示研报正文：收到第一个 token 时切到屏幕 3。

export type RetrievalScreenProps = Readonly<{
  state: SearchState;
  onStop: () => void;
  categoryLabel: (category: string) => string;
}>;

export function RetrievalScreen({ state, onStop, categoryLabel }: RetrievalScreenProps) {
  return (
    <section aria-label="检索推理" className="mx-auto w-full max-w-pipeline px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-card bg-surface px-5 py-4 shadow-e2">
        <div className="w-full min-w-0 sm:w-auto sm:flex-1">
          <p className="text-label font-semibold text-ink-soft">正在检索</p>
          <h1 className="mt-1 break-words font-display text-lg font-bold leading-heading">{state.query}</h1>
        </div>
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-pill border-2 border-line border-t-accent motion-reduce:animate-none"
          />
          <p className="text-sm text-ink-soft">按 Esc 也可停止</p>
          <Button variant="secondary" icon={Square} onClick={onStop}>
            停止检索
          </Button>
        </div>
      </div>
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-pipeline">
        <div className="min-w-0">
          <HeronStepper steps={state.steps} rewrittenQueries={state.rewrittenQueries} />
        </div>
        <div className="min-w-0">
          <LiveSourceRadar sources={state.rawSources} categoryLabel={categoryLabel} />
        </div>
      </div>
    </section>
  );
}
