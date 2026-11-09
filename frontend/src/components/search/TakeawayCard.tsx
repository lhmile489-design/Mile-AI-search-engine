"use client";

import { Badge } from "@/components/ui/Badge";
import { CITATION_PATTERN } from "@/lib/citations";
import type { Takeaway } from "@/types";

// F23：核心要点卡片。研报正文前展示 3–5 条，每条带可点击的引用角标。
// takeaways 为 null 或空时整块不显示（决策 D4：不留空壳）。

export type TakeawayCardProps = Readonly<{
  takeaways: ReadonlyArray<Takeaway> | null;
  maxCitation: number;
  onCite: (index: number) => void;
}>;

/** 要点文本里的 [n] 切分为纯文本 / 角标按钮。与正文角标同一套行为。 */
function TakeawayText({ text, maxCitation, onCite }: Readonly<{ text: string; maxCitation: number; onCite: (index: number) => void }>) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const match of text.matchAll(CITATION_PATTERN)) {
    const index = Number(match[1]);
    const at = match.index ?? 0;
    if (at > cursor) {
      key += 1;
      parts.push(<span key={key}>{text.slice(cursor, at)}</span>);
    }
    if (Number.isSafeInteger(index) && index >= 1 && index <= maxCitation) {
      key += 1;
      parts.push(
        <button
          key={key}
          type="button"
          aria-label={`查看第 ${index} 个信源`}
          onClick={() => onCite(index)}
          className="mx-0.5 inline-block min-w-5 cursor-pointer rounded-xs bg-accent-soft px-1 text-center align-baseline font-body text-xs font-bold leading-snug text-accent-soft-ink hover:bg-accent-tint-press"
        >
          {index}
        </button>,
      );
    } else {
      key += 1;
      parts.push(<span key={key}>{match[0]}</span>);
    }
    cursor = at + match[0].length;
  }
  if (cursor < text.length) {
    key += 1;
    parts.push(<span key={key}>{text.slice(cursor)}</span>);
  }
  return <>{parts}</>;
}

export function TakeawayCard({ takeaways, maxCitation, onCite }: TakeawayCardProps) {
  if (!takeaways || takeaways.length === 0) return null;
  return (
    <section aria-label="核心要点" className="rounded-card bg-surface px-6 py-5 shadow-e2">
      <h2 className="font-display text-lg font-bold text-ink">核心要点</h2>
      <ol className="mt-4 grid gap-3">
        {takeaways.map((item, i) => (
          <li key={i} className="flex items-start gap-3">
            <Badge tone="soft" dot={false} className="mt-0.5 shrink-0">
              {i + 1}
            </Badge>
            <p className="min-w-0 text-ui leading-body text-ink-soft">
              <TakeawayText text={item.text} maxCitation={maxCitation} onCite={onCite} />
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
