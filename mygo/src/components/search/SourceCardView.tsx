
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, Copy, FileText } from "lucide-react";
import { formatDate } from "@/lib/format";
import { splitPassage, type Range } from "@/lib/highlight";
import type { SourceCard } from "@/types";
import { Favicon } from "./Favicon";

// 信源卡片：对齐 UI 改版稿 .source-card。契约 §4.1：
// passage 为 null 时只高亮卡片；done / 快照里有 highlight 时，在 passage 内高亮被引用的句子。
// 激活态 = 强调色描边，不用左侧竖条。分数条只在 scores.final 有值时显示（决策 D4）。

export type SourceCardViewProps = Readonly<{
  source: SourceCard;
  /** 只有被点击角标对应的那一句（0 或 1 个区间），其余信源不高亮 */
  ranges: ReadonlyArray<Range>;
  active: boolean;
  /** 每次点击角标 +1，用来在同一张卡片上重复触发展开 */
  activeNonce: number;
  categoryLabel: (category: string) => string;
  /** F06：点卡片，高亮正文里指向它的角标 */
  onFocus: (index: number) => void;
}>;

export function SourceCardView({ source, ranges, active, activeNonce, categoryLabel, onFocus }: SourceCardViewProps) {
  const [expanded, setExpanded] = useState(false);
  const [bibState, setBibState] = useState<"idle" | "copied" | "failed">("idle");
  const date = formatDate(source.publishedAt);
  const passage = source.passage;
  const finalScore = source.scores.final;

  // F13：仅 preprint 给「复制 BibTeX」；bibtex 为 null 时按钮停用并说明。
  const isPreprint = source.category === "preprint";
  const bibtex = source.bibtex;

  const copyBibtex = async () => {
    if (!bibtex) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(bibtex);
      } else {
        // 降级：execCommand 兜底（非 https / 老浏览器无 clipboard API）
        const ta = document.createElement("textarea");
        ta.value = bibtex;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (!ok) throw new Error("execCommand failed");
      }
      setBibState("copied");
      window.setTimeout(() => setBibState("idle"), 2000);
    } catch {
      setBibState("failed");
      window.setTimeout(() => setBibState("idle"), 2500);
    }
  };

  // 被角标激活时自动展开，保证高亮的句子可见
  useEffect(() => {
    if (active) setExpanded(true);
  }, [active, activeNonce]);

  const segments = useMemo(() => {
    if (!passage) return null;
    return splitPassage(passage, ranges);
  }, [passage, ranges]);

  const hasMark = segments?.some((segment) => segment.marked) ?? false;

  return (
    <li
      id={source.index !== null ? `source-${source.index}` : undefined}
      aria-current={active ? "true" : undefined}
      onClick={(e) => {
        if (source.index === null || (e.target as HTMLElement).closest("a,button")) return;
        onFocus(source.index);
      }}
      className="source-card"
    >
      <div className="source-card-header">
        <button
          type="button"
          aria-label={`高亮正文中引用第 ${source.index} 个信源的角标`}
          aria-pressed={active}
          disabled={source.index === null}
          onClick={() => source.index !== null && onFocus(source.index)}
          className="source-index"
        >
          {source.index}
        </button>
        <Favicon url={source.faviconUrl} />
        <span className="source-domain" title={source.domain}>{source.domain}</span>
        <span className="source-category-badge">{categoryLabel(source.category)}</span>
      </div>

      <a href={source.url} target="_blank" rel="noopener noreferrer" className="source-title">
        {source.title}
      </a>

      {passage && segments ? (
        <>
          <p className={expanded ? "source-snippet" : "source-snippet line-clamp-3"}>
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
        </>
      ) : (
        <p className="source-snippet text-ink-muted">该信源没有可展示的原文片段。</p>
      )}

      {finalScore !== null ? (
        <div className="source-score-row" title="综合分（相关度、权威度、时效性加权）">
          <span className="source-score-bar" aria-hidden="true">
            <span
              className="source-score-fill block"
              style={{ width: `${Math.round(Math.min(Math.max(finalScore, 0), 1) * 100)}%` }}
            />
          </span>
          <span className="source-score-num">{finalScore.toFixed(2)}</span>
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {date ? <span className="font-mono text-xs tabular-nums text-ink-faint">{date}</span> : null}
        {passage && segments ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="source-link-btn"
          >
            {expanded ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
            {expanded ? "收起原文片段" : "展开原文片段"}
            {hasMark && !expanded ? "（含高亮句子）" : ""}
          </button>
        ) : null}
        {isPreprint ? (
          <button
            type="button"
            onClick={copyBibtex}
            disabled={!bibtex}
            title={bibtex ? "复制 BibTeX 引用" : "该信源未提供 BibTeX"}
            className="source-link-btn"
          >
            {bibState === "copied" ? (
              <Check size={13} aria-hidden="true" />
            ) : bibState === "failed" ? (
              <FileText size={13} aria-hidden="true" />
            ) : (
              <Copy size={13} aria-hidden="true" />
            )}
            {bibState === "copied" ? "已复制" : bibState === "failed" ? "复制失败" : "复制 BibTeX"}
            {!bibtex ? "（未提供）" : ""}
          </button>
        ) : null}
        {bibState === "failed" ? (
          <span role="status" className="text-xs text-danger">无法访问剪贴板，请手动复制</span>
        ) : null}
      </div>
    </li>
  );
}
