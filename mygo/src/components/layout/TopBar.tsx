
import { RefreshCw, Settings, PanelLeft } from "lucide-react";
import logoUrl from "@/assets/appLogo.png";
import { ThemePicker } from "@/components/layout/ThemePicker";

// 玻璃顶栏：对齐 docs/ui-redesign-preview.html。高度 --h-topbar（52px），
// 左：侧栏开关 + logo + 品牌名 + 面包屑；右：主题选择器、新检索、设置。

export type TopBarProps = Readonly<{
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onHome: () => void;
  onOpenSettings: () => void;
  /** 结果页 / 检索页时显示当前问题作为面包屑 */
  crumb?: string | null;
}>;

const iconBtn =
  "inline-flex h-control w-control cursor-pointer items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-accent-tint-hover hover:text-ink";

export function TopBar({ sidebarOpen, onToggleSidebar, onHome, onOpenSettings, crumb = null }: TopBarProps) {
  return (
    <header className="glass-header fixed inset-x-0 top-0 z-header flex h-topbar items-center gap-3 border-b border-line px-4">
      <button
        type="button"
        aria-label="历史记录"
        aria-expanded={sidebarOpen}
        aria-controls="history-sidebar"
        title="历史记录（Ctrl/⌘+B）"
        onClick={onToggleSidebar}
        className={iconBtn}
      >
        <PanelLeft size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onHome}
        aria-label="Mile AI Search，返回首页"
        className="inline-flex cursor-pointer items-center gap-3"
      >
        <img src={logoUrl} alt="" className="h-avatar w-avatar flex-shrink-0 object-contain" />
        <span className="font-display text-lg font-bold tracking-tight text-ink">Mile AI Search</span>
      </button>
      {crumb ? (
        <>
          <span aria-hidden="true" className="h-5 w-px flex-shrink-0 bg-line" />
          <span className="hidden max-w-crumb truncate text-sm text-ink-muted md:block" title={crumb}>
            {crumb}
          </span>
        </>
      ) : null}
      <div className="ml-auto flex items-center gap-2">
        <ThemePicker />
        <button
          type="button"
          onClick={onHome}
          className="inline-flex h-8 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink-soft shadow-e1 transition hover:-translate-y-px hover:text-ink hover:shadow-e3"
        >
          <RefreshCw size={14} aria-hidden="true" />
          新检索
        </button>
        <button type="button" aria-label="设置" onClick={onOpenSettings} className={iconBtn}>
          <Settings size={18} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
