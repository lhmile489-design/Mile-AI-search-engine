"use client";

import { History, Search } from "lucide-react";

// 玻璃顶栏：DESIGN.md §7。左侧历史开关 + 品牌方块，点品牌回首屏（等同「新检索」）。

export type TopBarProps = Readonly<{
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onHome: () => void;
}>;

export function TopBar({ sidebarOpen, onToggleSidebar, onHome }: TopBarProps) {
  return (
    <header className="glass-header sticky top-0 z-header flex h-16 items-center gap-3 px-4">
      <button
        type="button"
        aria-label="历史记录"
        aria-expanded={sidebarOpen}
        aria-controls="history-sidebar"
        title="历史记录（Ctrl/⌘+B）"
        onClick={onToggleSidebar}
        className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-md text-ink hover:bg-accent-tint-hover"
      >
        <History size={20} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onHome}
        aria-label="Mile AI Search，返回首页"
        className="inline-flex cursor-pointer items-center gap-3 rounded-md px-1 py-1"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-sm bg-accent text-accent-on shadow-e2">
          <Search size={16} aria-hidden="true" />
        </span>
        <span className="font-display text-lg font-bold text-ink">Mile AI Search</span>
      </button>
    </header>
  );
}
