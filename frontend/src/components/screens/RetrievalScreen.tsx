import { Square } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { HeronStepper } from "@/components/search/HeronStepper";
import { LiveSourceRadar } from "@/components/search/LiveSourceRadar";
import type { SearchState } from "@/store/state";

// 屏幕 2：检索推理态（PRODUCT.md §4.2）。左 7 栏时间轴，右 5 栏信源雷达；小于 1024px 上下排列。
// 本屏不显示研报正文：收到第一个 token 时切到屏幕 3。

export type RetrievalScreenProps = Readonly<{
  state: SearchState;
  onStop: () => void;
  categoryLabel: (category: string) => string;
}>;

export function RetrievalScreen({ state, onStop, categoryLabel }: RetrievalScreenProps) {
  return (
    <section aria-label="检索推理" className="mx-auto w-full max-w-pipeline px-5 pb-16 pt-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="w-full min-w-0 sm:w-auto sm:flex-1">
          <p className="text-label font-semibold text-ink-soft">正在检索</p>
          <h1 className="mt-1 break-words font-display text-xl font-bold leading-heading">{state.query}</h1>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm text-ink-soft">按 Esc 也可停止</p>
          <Button variant="secondary" icon={Square} onClick={onStop}>
            停止检索
          </Button>
        </div>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-7">
          <HeronStepper steps={state.steps} rewrittenQueries={state.rewrittenQueries} />
        </div>
        <div className="min-w-0 lg:col-span-5">
          <LiveSourceRadar sources={state.rawSources} categoryLabel={categoryLabel} />
        </div>
      </div>
    </section>
  );
}
