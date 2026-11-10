
import { useEffect, useMemo, useRef } from "react";
import { ChevronLeft, PanelLeftOpen, Search, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatCount, formatDateTime } from "@/lib/format";
import type { HistoryState } from "@/hooks/useHistory";

// 历史侧边栏：对齐 docs/ui-redesign-preview.html 的 .sidebar。
//   >= 1024px：展开 --w-sidebar（主内容让位）；收起为 --w-sidebar-compact 的窄条
//   <  1024px：展开时覆盖在内容上，带遮罩；收起时完全隐藏
// 条目按「今天 / 更早」分组，当前条目 --accent-soft 底 + --accent-deep 字，没有左侧竖条。
// 点击条目调用 GET /api/history/{id} 的快照恢复结果页，不重新检索（F09）。

export type HistorySidebarProps = Readonly<{
  open: boolean;
  onToggle: () => void;
  history: HistoryState;
  currentId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}>;

function isToday(value: string | number | Date | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export function HistorySidebar({ open, onToggle, history, currentId, onSelect, onDelete }: HistorySidebarProps) {
  const collapseRef = useRef<HTMLButtonElement>(null);

  // 键盘打开侧边栏（Ctrl/Cmd+B）后把焦点移进去，关闭时还给之前的元素，保证焦点始终可见、不丢
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    collapseRef.current?.focus();
    return () => previous?.focus?.();
  }, [open]);

  const groups = useMemo(() => {
    const today = history.records.filter((item) => isToday(item.createdAt));
    const earlier = history.records.filter((item) => !isToday(item.createdAt));
    return [
      { label: "今天", items: today },
      { label: "更早", items: earlier },
    ].filter((group) => group.items.length > 0);
  }, [history.records]);

  if (!open) {
    return (
      <nav
        aria-label="历史记录（已收起）"
        className="fixed bottom-0 left-0 top-topbar z-sticky hidden w-sidebar-compact flex-col items-center border-r border-line bg-surface pt-3 shadow-e1 lg:flex"
      >
        <button
          type="button"
          aria-label="展开历史记录"
          aria-expanded={false}
          aria-controls="history-sidebar"
          onClick={onToggle}
          className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-ink-soft transition-colors duration-fast hover:bg-accent-tint-hover hover:text-ink"
        >
          <PanelLeftOpen size={16} aria-hidden="true" />
        </button>
      </nav>
    );
  }

  return (
    <>
      <div aria-hidden="true" onClick={onToggle} className="fixed inset-0 top-topbar z-sticky bg-ink opacity-30 lg:hidden" />
      <aside
        id="history-sidebar"
        aria-label="历史记录"
        className="fixed bottom-0 left-0 top-topbar z-sticky flex w-sidebar max-w-full flex-col border-r border-line bg-surface shadow-e1"
      >
        <div className="flex min-h-topbar items-center justify-between border-b border-line px-4 pb-3 pt-4">
          <h2 className="font-display text-label font-bold uppercase tracking-wide text-ink">历史记录</h2>
          <button
            ref={collapseRef}
            type="button"
            aria-label="收起历史记录"
            aria-expanded
            aria-controls="history-sidebar"
            onClick={onToggle}
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-ink-soft transition-colors duration-fast hover:bg-accent-tint-hover"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          {history.failed ? (
            <p role="status" className="px-4 py-5 text-sm text-danger">
              历史记录读取失败，请确认后端服务已启动。
            </p>
          ) : history.records.length === 0 && !history.loading ? (
            <p className="px-4 py-5 text-sm text-ink-soft">还没有历史记录。完成一次检索后会出现在这里。</p>
          ) : (
            groups.map((group) => (
              <section key={group.label} aria-label={group.label}>
                <h3 className="whitespace-nowrap px-4 pb-2 pt-4 font-body text-xs font-bold uppercase tracking-meta text-ink-faint">
                  {group.label}
                </h3>
                <ul>
                  {group.items.map((item) => {
                    const current = item.id === currentId;
                    const when = formatDateTime(item.createdAt);
                    return (
                      <li key={item.id} className="group relative">
                        <button
                          type="button"
                          aria-current={current ? "true" : undefined}
                          onClick={() => onSelect(item.id)}
                          title={when ? `${item.query}（${when}）` : item.query}
                          className={cn(
                            // 单行条目（UI 改版稿 .sidebar-item）；焦点环画在条目内侧，外侧会被滚动容器裁掉
                            "flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left text-ui transition-colors duration-fast focus-visible:-outline-offset-4",
                            current
                              ? "bg-accent-soft font-semibold text-accent-deep"
                              : "text-ink-soft hover:bg-accent-tint-hover hover:text-ink",
                          )}
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                            <Search size={16} aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1 truncate">{item.query}</span>
                          {current ? (
                            <span className="sidebar-item-badge" aria-label={formatCount(item.sourceCount, "个信源")}>
                              {item.sourceCount}
                            </span>
                          ) : (
                            <span className="shrink-0 whitespace-nowrap text-xs font-normal text-ink-faint transition-opacity duration-fast group-hover:opacity-0">
                              {item.sourceCount}个信源
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          aria-label={`删除历史记录：${item.query}`}
                          onClick={() => onDelete(item.id)}
                          className="absolute right-2 top-1 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md bg-surface text-ink-soft opacity-0 transition-opacity duration-fast hover:bg-accent-tint-hover focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-line px-4 py-3">
          <kbd className="rounded-xs bg-surface-sunk px-1.5 font-mono text-xs text-ink-muted shadow-e1">Ctrl+B</kbd>
          <span className="text-xs text-ink-faint">切换侧边栏</span>
        </div>
      </aside>
    </>
  );
}
