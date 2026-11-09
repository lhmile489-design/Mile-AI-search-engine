"use client";

import { useEffect, useRef } from "react";
import { PanelLeftClose, PanelLeftOpen, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatCount, formatDateTime } from "@/lib/format";
import type { HistoryState } from "@/hooks/useHistory";

// 历史侧边栏：DESIGN.md §7。--surface、elevation-1、--z-sticky，条目之间用分隔线，
// 当前条目 --accent-soft 底 + --accent-deep 字。
//   >= 1024px：展开 --w-sidebar（主内容让位）；收起为 --w-sidebar-compact 的窄条
//   <  1024px：展开时覆盖在内容上，带遮罩；收起时完全隐藏
// 点击条目调用 GET /api/history/{id} 的快照恢复结果页，不重新检索（F09）。

export type HistorySidebarProps = Readonly<{
  open: boolean;
  onToggle: () => void;
  history: HistoryState;
  currentId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}>;

export function HistorySidebar({ open, onToggle, history, currentId, onSelect, onDelete }: HistorySidebarProps) {
  const collapseRef = useRef<HTMLButtonElement>(null);

  // 键盘打开侧边栏（Ctrl/Cmd+B）后把焦点移进去，关闭时还给之前的元素，保证焦点始终可见、不丢
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    collapseRef.current?.focus();
    return () => previous?.focus?.();
  }, [open]);

  if (!open) {
    return (
      <nav
        aria-label="历史记录（已收起）"
        className="fixed bottom-0 left-0 top-16 z-sticky hidden w-sidebar-compact justify-center bg-surface pt-4 shadow-e1 lg:flex"
      >
        <button
          type="button"
          aria-label="展开历史记录"
          aria-expanded={false}
          aria-controls="history-sidebar"
          onClick={onToggle}
          className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-md text-ink-soft hover:bg-accent-tint-hover"
        >
          <PanelLeftOpen size={20} aria-hidden="true" />
        </button>
      </nav>
    );
  }

  return (
    <>
      <div aria-hidden="true" onClick={onToggle} className="fixed inset-0 top-16 z-sticky bg-ink opacity-30 lg:hidden" />
      <aside
        id="history-sidebar"
        aria-label="历史记录"
        className="fixed bottom-0 left-0 top-16 z-sticky flex w-sidebar max-w-full flex-col bg-surface shadow-e1"
      >
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="font-display text-lg font-bold">历史记录</h2>
          <button
            ref={collapseRef}
            type="button"
            aria-label="收起历史记录"
            aria-expanded
            aria-controls="history-sidebar"
            onClick={onToggle}
            className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-md text-ink-soft hover:bg-accent-tint-hover"
          >
            <PanelLeftClose size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {history.failed ? (
            <p role="status" className="px-4 py-5 text-sm text-danger">
              历史记录读取失败，请确认后端服务已启动。
            </p>
          ) : history.records.length === 0 && !history.loading ? (
            <p className="px-4 py-5 text-sm text-ink-soft">还没有历史记录。完成一次检索后会出现在这里。</p>
          ) : (
            <ul>
              {history.records.map((item) => {
                const current = item.id === currentId;
                const when = formatDateTime(item.createdAt);
                return (
                  <li key={item.id} className="group relative border-t border-line first:border-t-0">
                    <button
                      type="button"
                      aria-current={current ? "true" : undefined}
                      onClick={() => onSelect(item.id)}
                      className={cn(
                        // 焦点环画在条目内侧：外侧会被滚动容器裁掉
                        "block w-full cursor-pointer px-4 py-3 pr-14 text-left focus-visible:-outline-offset-4",
                        current ? "bg-accent-soft text-accent-deep" : "text-ink hover:bg-accent-tint-hover",
                      )}
                    >
                      <span className="line-clamp-2 break-words text-ui font-semibold">{item.query}</span>
                      <span className={cn("mt-1 block text-sm", current ? "text-accent-soft-ink" : "text-ink-soft")}>
                        {when ? `${when} · ` : ""}
                        {formatCount(item.sourceCount, "个信源")}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`删除历史记录：${item.query}`}
                      onClick={() => onDelete(item.id)}
                      className="absolute right-2 top-2 inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-md text-ink-soft hover:bg-accent-tint-hover"
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}
