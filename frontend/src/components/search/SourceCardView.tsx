"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { collectRanges, splitPassage } from "@/lib/highlight";
import type { Citation, SourceCard } from "@/types";
import { CategoryTag } from "./CategoryTag";
import { Favicon } from "./Favicon";

// 信源卡片（证据抽屉里的一行）。契约 §4.1：
// passage 为 null 时只高亮卡片；done / 快照里有 highlight 时，在 passage 内高亮被引用的句子。
// 抽屉是 elevation-3 面板，里面不再放 elevation-2 卡片（DESIGN.md §3.2），用分隔线分组。

export type SourceCardViewProps = Readonly<{
  source: SourceCard;
  citations: ReadonlyArray<Citation>;
  active: boolean;
  /** 每次点击角标 +1，用来在同一张卡片上重复触发展开 */
  activeNonce: number;
  categoryLabel: (category: string) => string;
}>;

export function SourceCardView({ source, citations, active, activeNonce, categoryLabel }: SourceCardViewProps) {
  const [expanded, setExpanded] = useState(false);
  const date = formatDate(source.publishedAt);
  const passage = source.passage;

  // 被角标激活时自动展开，保证高亮的句子可见
  useEffect(() => {
    if (active) setExpanded(true);
  }, [active, activeNonce]);

  const segments = useMemo(() => {
    if (!passage || source.index === null) return null;
    return splitPassage(passage, collectRanges(citations, source.index, passage.length));
  }, [passage, source.index, citations]);

  const hasMark = segments?.some((segment) => segment.marked) ?? false;

  return (
    <li
      id={source.index !== null ? `source-${source.index}` : undefined}
      aria-current={active ? "true" : undefined}
      className={cn(
        "border-t border-line px-6 py-5 first:border-t-0",
        active ? "source-active bg-accent-soft" : "bg-surface",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex min-w-6 shrink-0 justify-center rounded-xs bg-accent-soft px-1 text-xs font-bold leading-6 text-accent-soft-ink">
          {source.index}
        </span>
        <div className="min-w-0 flex-1">
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="break-words text-ui font-semibold text-accent-deep underline"
          >
            {source.title}
          </a>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Favicon url={source.faviconUrl} />
            <span className="font-mono text-sm text-ink-soft">{source.domain}</span>
            <CategoryTag label={categoryLabel(source.category)} />
            {date ? <span className="font-mono text-sm tabular-nums text-ink-soft">{date}</span> : null}
          </div>
        </div>
      </div>

      {passage && segments ? (
        <div className="mt-3">
          <p
            className={cn(
              "whitespace-pre-wrap break-words text-sm leading-body text-ink-soft",
              expanded ? "" : "line-clamp-4",
            )}
          >
            {segments.map((segment, i) =>
              segment.marked ? (
                <mark key={i} className="evidence-mark">
                  {segment.text}
                </mark>
              ) : (
                <span key={i}>{segment.text}</span>
              ),
            )}
          </p>
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="mt-2 inline-flex cursor-pointer items-center gap-1 text-sm font-semibold text-accent-deep"
          >
            {expanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
            {expanded ? "收起原文片段" : "展开原文片段"}
            {hasMark && !expanded ? "（含高亮句子）" : ""}
          </button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink-muted">该信源没有可展示的原文片段。</p>
      )}
    </li>
  );
}
