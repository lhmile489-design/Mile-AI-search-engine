import type { RawSource } from "@/types";
import { formatCount } from "@/lib/format";
import { CategoryTag } from "./CategoryTag";
import { Favicon } from "./Favicon";

// LiveSourceRadar 信源抓取：DESIGN.md §7。每到一个信源追加一行；未到达的位置用骨架块占位。
// 骨架行数只是版面占位，不代表任何数量。

const SKELETON_ROWS = 4;

export type LiveSourceRadarProps = Readonly<{
  sources: ReadonlyArray<RawSource>;
  categoryLabel: (category: string) => string;
}>;

export function LiveSourceRadar({ sources, categoryLabel }: LiveSourceRadarProps) {
  return (
    <section aria-label="信源抓取" className="rounded-card bg-surface px-6 py-7 shadow-e2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-bold">信源抓取</h2>
        <p className="font-mono text-sm tabular-nums text-ink-soft" aria-live="polite">
          {formatCount(sources.length, "个信源")}
        </p>
      </div>
      <ul className="mt-4">
        {sources.map((source) => (
          <li key={source.id} className="row-in flex items-start gap-3 border-t border-line py-3 first:border-t-0">
            <span className="mt-1">
              <Favicon url={source.faviconUrl} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate font-mono text-sm text-ink">{source.domain}</p>
                <CategoryTag label={categoryLabel(source.category)} />
              </div>
              <p className="mt-1 truncate text-sm text-ink-soft" title={source.title}>
                {source.title}
              </p>
            </div>
          </li>
        ))}
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <li
            key={`sk-${i}`}
            aria-hidden="true"
            className="flex items-start gap-3 border-t border-line py-3 first:border-t-0"
          >
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
