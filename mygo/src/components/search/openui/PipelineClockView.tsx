
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { CitationText } from "./CitationText";
import type { CardTextProps } from "./types";

// PipelineClockCard 的渲染：流水线各阶段耗时，点击展开时延详情。
// 水平条宽度按耗时比例，单位由卡片 unit 决定。

export type StageData = Readonly<{
  name: string;
  duration: number;
  detail: string;
}>;

export type PipelineClockViewProps = CardTextProps &
  Readonly<{
    title: string;
    unit: "cycles" | "ns" | "us" | "ms";
    stages: ReadonlyArray<StageData>;
  }>;

const UNIT_LABEL: Readonly<Record<string, string>> = {
  cycles: "cycles",
  ns: "ns",
  us: "μs",
  ms: "ms",
};

export function PipelineClockView({ title, unit, stages, onCite, maxCitation }: PipelineClockViewProps) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const max = Math.max(...stages.map((s) => s.duration), 1);

  return (
    <div className="rounded-card bg-surface px-6 py-5 shadow-e2">
      <h3 className="font-display text-lg font-bold text-ink">
        <CitationText text={title} maxCitation={maxCitation} onCite={onCite} />
      </h3>
      <ul className="mt-4 grid gap-3">
        {stages.map((stage, i) => {
          const open = openIdx === i;
          const pct = Math.min(100, (stage.duration / max) * 100);
          return (
            <li key={i} className="rounded-md bg-surface-sunk px-4 py-3">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenIdx(open ? null : i)}
                className="flex w-full cursor-pointer items-center justify-between gap-3 text-left"
              >
                <span className="min-w-0 text-ui font-semibold text-ink">{stage.name}</span>
                <span className="flex shrink-0 items-center gap-2 font-mono text-sm tabular-nums text-ink-soft">
                  {stage.duration} {UNIT_LABEL[unit] ?? unit}
                  {open ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
                </span>
              </button>
              <div className="mt-2 h-2 rounded-pill bg-line" aria-hidden="true">
                <div className={cn("h-full rounded-pill bg-accent transition-[width] duration-base")} style={{ width: `${pct}%` }} />
              </div>
              {open ? (
                <p className="mt-2.5 border-t border-line pt-2.5 text-sm leading-body text-ink-soft">
                  <CitationText text={stage.detail} maxCitation={maxCitation} onCite={onCite} />
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
