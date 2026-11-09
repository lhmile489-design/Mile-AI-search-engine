"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { rangeForMarker, type Range } from "@/lib/highlight";
import type { Citation, SourceCard } from "@/types";
import { SourceCardView } from "./SourceCardView";

// 证据抽屉：DESIGN.md §7。
//   >= 1024px：右栏内嵌，elevation-3，吸顶，自带滚动
//   <  1024px：从右侧滑出的覆盖式抽屉，elevation-4，--z-drawer，实色底（不用玻璃）
// 同一个元素靠响应式类名切换形态；关闭状态下用 inert 阻止焦点进入屏外内容。

export type EvidenceDrawerProps = Readonly<{
  sources: ReadonlyArray<SourceCard>;
  citations: ReadonlyArray<Citation>;
  activeCitation: Readonly<{ index: number; markerStart: number | null; nonce: number }> | null;
  /** 覆盖式抽屉是否打开（桌面内嵌形态下忽略） */
  open: boolean;
  desktop: boolean;
  onClose: () => void;
  categoryLabel: (category: string) => string;
}>;

const NO_RANGES: ReadonlyArray<Range> = [];

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function EvidenceDrawer({
  sources,
  citations,
  activeCitation,
  open,
  desktop,
  onClose,
  categoryLabel,
}: EvidenceDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const overlayOpen = !desktop && open;

  // 点击角标：滚动到第 n 个信源
  useEffect(() => {
    if (!activeCitation) return;
    const container = scrollRef.current;
    const target = document.getElementById(`source-${activeCitation.index}`);
    if (!container || !target) return;
    // 只滚动抽屉自己的滚动区，不用 scrollIntoView：它会连带滚动整个页面，把用户从正在读的位置带走
    const top = container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTo({ top, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [activeCitation]);

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
        aria-label="证据抽屉"
        inert={!desktop && !open ? true : undefined}
        className={cn(
          "flex flex-col overflow-hidden bg-surface",
          // 桌面：内嵌 + 吸顶
          "lg:sticky lg:top-20 lg:rounded-card lg:shadow-e3",
          // 窄屏：右侧滑出（只过渡 transform）
          "max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-drawer max-lg:w-full max-lg:max-w-md",
          "max-lg:shadow-e4 max-lg:transition-transform max-lg:duration-base",
          open ? "max-lg:translate-x-0" : "max-lg:translate-x-full",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-6 py-4">
          <h2 className="font-display text-lg font-bold">证据 · {formatCount(sources.length, "个信源")}</h2>
          <span className="lg:hidden">
            <button
              ref={closeRef}
              type="button"
              aria-label="关闭证据抽屉"
              onClick={onClose}
              className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-md text-accent-deep hover:bg-accent-tint-hover"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </span>
        </div>
        <div ref={scrollRef} className="pane-scroll min-h-0 flex-1 overflow-y-auto">
          {sources.length === 0 ? (
            <p className="px-6 py-7 text-ui text-ink-soft">本次没有可引用的信源。</p>
          ) : (
            <ul>
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
                />
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}
