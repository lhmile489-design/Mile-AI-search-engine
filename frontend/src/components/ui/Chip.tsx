import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

// chip：DESIGN.md §6.4。
// 传 onClick 时渲染为 <button>，悬停上移 2px 并升到 elevation-2（阴影在 after 上，只过渡 opacity）。
// 不传 onClick 时是静态 <span>，没有悬停效果（§3.2 规则 5：只有可点击的元素才上浮）。

export type ChipProps = Readonly<{
  children: ReactNode;
  icon?: LucideIcon;
  onClick?: () => void;
  className?: string;
}>;

const BASE =
  "relative inline-flex items-center gap-2 rounded-pill bg-surface px-4 py-2 " +
  "font-body text-label font-semibold text-ink-soft shadow-e1";

const CLICKABLE =
  "cursor-pointer transition-transform duration-fast hover:-translate-y-0.5 " +
  "after:pointer-events-none after:absolute after:inset-0 after:rounded-pill after:shadow-e2 " +
  "after:opacity-0 after:transition-opacity after:duration-fast hover:after:opacity-100";

export function Chip({ children, icon: Icon, onClick, className }: ChipProps) {
  const content = (
    <>
      {Icon ? <Icon size={16} aria-hidden="true" /> : null}
      {children}
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(BASE, CLICKABLE, className)}>
        {content}
      </button>
    );
  }
  return <span className={cn(BASE, className)}>{content}</span>;
}

// chip 内的强调字：--accent-deep 600
export function ChipEmphasis({ children }: Readonly<{ children: ReactNode }>) {
  return <strong className="font-semibold text-accent-deep">{children}</strong>;
}
