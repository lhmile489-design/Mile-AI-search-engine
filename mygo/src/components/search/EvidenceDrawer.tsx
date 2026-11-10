
import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Link2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { rangeForMarker, type Range } from "@/lib/highlight";
import type { Citation, SourceCard } from "@/types";
import { SourceCardView } from "./SourceCardView";

// 信源与证据面板：对齐 docs/ui-redesign-preview.html 的 .preview-panel。
//   >= 1024px：结果页右栏，吸顶，自带滚动
//   <  1024px：从右侧滑出的覆盖式抽屉，elevation-4，--z-drawer，实色底（不用玻璃）
// 两个页签：「信源」是信源卡片列表；「证据」是研报引用句在原文中的高亮段落（契约 §7.2 的 highlight）。
// 关闭状态下用 inert 阻止焦点进入屏外内容。

export type EvidenceDrawerProps = Readonly<{
  sources: ReadonlyArray<SourceCard>;
  citations: ReadonlyArray<Citation>;
  activeCitation: Readonly<{ index: number; markerStart: number | null; nonce: number }> | null;
  /** 覆盖式抽屉是否打开（桌面内嵌形态下忽略） */
  open: boolean;
  desktop: boolean;
  onClose: () => void;
  onFocusSource: (index: number) => void;
  categoryLabel: (category: string) => string;
}>;

type PanelTab = "sources" | "evidence";

type EvidenceItem = Readonly<{ key: string; index: number; text: string; source: SourceCard }>;

const NO_RANGES: ReadonlyArray<Range> = [];

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 每个引用句在被引信源 passage 里的高亮段落，按信源编号排序、同一区间去重。 */
function collectEvidence(sources: ReadonlyArray<SourceCard>, citations: ReadonlyArray<Citation>): ReadonlyArray<EvidenceItem> {
  const byIndex = new Map<number, SourceCard>();
  for (const source of sources) if (source.index !== null) byIndex.set(source.index, source);
  const seen = new Set<string>();
  const items: EvidenceItem[] = [];
  for (const c of citations) {
    const source = byIndex.get(c.index);
    if (!c.highlight || !source?.passage) continue;
    const start = Math.max(0, Math.min(c.highlight.start, source.passage.length));
    const end = Math.max(0, Math.min(c.highlight.end, source.passage.length));
    const key = `${c.index}:${start}:${end}`;
    if (end <= start || seen.has(key)) continue;
    seen.add(key);
    items.push({ key, index: c.index, text: source.passage.slice(start, end), source });
  }
  return items.sort((a, b) => a.index - b.index);
}

export function EvidenceDrawer({
  sources,
  citations,
  activeCitation,
  open,
  desktop,
  onClose,
  onFocusSource,
  categoryLabel,
}: EvidenceDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<PanelTab>("sources");
  const overlayOpen = !desktop && open;
  const evidence = useMemo(() => collectEvidence(sources, citations), [sources, citations]);

  // 点击角标：切回「信源」页签，再滚动到第 n 个信源
  useEffect(() => {
    if (!activeCitation) return;
    setTab("sources");
  }, [activeCitation]);

  useEffect(() => {
    if (!activeCitation || tab !== "sources") return;
    const container = scrollRef.current;
    const target = document.getElementById(`source-${activeCitation.index}`);
    if (!container || !target) return;
    // 只滚动面板自己的滚动区，不用 scrollIntoView：它会连带滚动整个页面，把用户从正在读的位置带走
    const top =
      container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top - 16;
    container.scrollTo({ top, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [activeCitation, tab]);

  // 覆盖式抽屉打开时把焦点移进去，关闭时还给之前的元素，保证键盘焦点不丢
  useEffect(() => {
    if (!overlayOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus?.();
  }, [overlayOpen]);

  return (
    <>
      {overlayOpen ? (
        <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-drawer bg-ink opacity-30 lg:hidden" />
      ) : null}
      <aside
        id="evidence-drawer"
        aria-label="信源与证据"
        inert={!desktop && !open ? true : undefined}
        className={cn(
          "preview-panel",
          // 窄屏：右侧滑出（只过渡 transform）
          "max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-drawer max-lg:w-full max-lg:max-w-md",
          "max-lg:shadow-e4 max-lg:transition-transform max-lg:duration-base",
          open ? "max-lg:translate-x-0" : "max-lg:translate-x-full",
        )}
      >
        <div className="preview-panel-header">
          <h2 className="preview-panel-title">
            <Link2 size={15} aria-hidden="true" className="text-accent" />
            信源与证据
          </h2>
          <div className="flex items-center gap-2">
            <div role="tablist" aria-label="信源与证据视图" className="preview-tab-group">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "sources"}
                onClick={() => setTab("sources")}
                className="preview-tab"
              >
                信源 <span className="font-mono tabular-nums">{sources.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "evidence"}
                onClick={() => setTab("evidence")}
                className="preview-tab"
              >
                证据 <span className="font-mono tabular-nums">{evidence.length}</span>
              </button>
            </div>
            <span className="lg:hidden">
              <button ref={closeRef} type="button" aria-label="关闭信源面板" onClick={onClose} className="icon-btn">
                <X size={18} aria-hidden="true" />
              </button>
            </span>
          </div>
        </div>

        <div ref={scrollRef} className="preview-body">
          {tab === "sources" ? (
            sources.length === 0 ? (
              <p className="px-4 py-6 text-sm text-ink-soft">本次没有可引用的信源。</p>
            ) : (
              <ul className="source-list">
                {sources.map((source) => (
                  <SourceCardView
                    key={source.id}
                    source={source}
                    ranges={
                      activeCitation && activeCitation.index === source.index && source.passage
                        ? rangeForMarker(citations, source.index, activeCitation.markerStart, source.passage.length)
                        : NO_RANGES
                    }
                    active={activeCitation?.index === source.index}
                    activeNonce={activeCitation?.nonce ?? 0}
                    categoryLabel={categoryLabel}
                    onFocus={onFocusSource}
                  />
                ))}
              </ul>
            )
          ) : evidence.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-soft">研报生成完成后，这里会列出每个引用在原文中对应的段落。</p>
          ) : (
            <div className="evidence-panel">
              {evidence.map((item) => (
                <section key={item.key} className="evidence-section">
                  <h3 className="msg-section-title font-body">引用 [{item.index}] 相关段落</h3>
                  <button
                    type="button"
                    onClick={() => onFocusSource(item.index)}
                    className="evidence-snippet block w-full cursor-pointer text-left"
                    title="高亮正文中引用该信源的角标"
                  >
                    {item.text}
                  </button>
                  <p className="evidence-snippet-meta">
                    <BookOpen size={12} aria-hidden="true" className="shrink-0" />
                    <span className="truncate">
                      {item.source.domain} · {item.source.title}
                    </span>
                  </p>
                </section>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
