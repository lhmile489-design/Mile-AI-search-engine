import type { RawSource } from "@/types";
import { formatCount } from "@/lib/format";
import { CategoryTag } from "./CategoryTag";
import { Favicon } from "./Favicon";

// LiveSourceRadar 信源抓取：对齐 UI 改版稿 .radar-panel。每到一个信源追加一行；
// 未到达的位置用骨架块占位。骨架行数只是版面占位，不代表任何数量。

const SKELETON_ROWS = 4;

export type LiveSourceRadarProps = Readonly<{
  sources: ReadonlyArray<RawSource>;
  categoryLabel: (category: string) => string;
}>;

export function LiveSourceRadar({ sources, categoryLabel }: LiveSourceRadarProps) {
  return (
    <section aria-label="信源抓取" className="overflow-hidden rounded-card bg-surface shadow-e2">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h2 className="font-display text-label font-bold uppercase tracking-tight">信源抓取</h2>
        <p className="font-mono text-sm font-semibold tabular-nums text-ink-muted" aria-live="polite">
          {formatCount(sources.length, "个信源")}
        </p>
      </div>
      <ul className="flex flex-col gap-1 px-4 py-3">
        {sources.map((source) => (
          <li key={source.id} className="row-in flex items-start gap-3 rounded-md px-3 py-2">
            <span className="mt-1">
              <Favicon url={source.faviconUrl} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate font-mono text-xs text-ink-soft">{source.domain}</p>
                <CategoryTag label={categoryLabel(source.category)} />
              </div>
              <p className="mt-1 truncate text-sm text-ink" title={source.title}>
                {source.title}
              </p>
            </div>
          </li>
        ))}
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <li key={`sk-${i}`} aria-hidden="true" className="flex items-start gap-3 rounded-md px-3 py-2">
            <span className="mt-1 h-4 w-4 shrink-0 rounded-xs bg-surface-sunk" />
            <div className="flex-1">
              <div className="h-4 w-1/2 rounded-xs bg-surface-sunk" />
              <div className="mt-2 h-4 w-3/4 rounded-xs bg-surface-sunk" />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
