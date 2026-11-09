import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// 卡片与面板：DESIGN.md §6.3、§3。
// Card  = elevation-2，内边距 --space-7 x --space-6。
// Panel = elevation-3，内部 grid，间距 --space-6。
// 卡片靠阴影成形，不加边框；面板里不要再放 Card（§3.2 规则 2：不卡片套卡片）。

const SURFACE = "rounded-card bg-surface px-6 py-7";

// 可点击卡片：悬停上移 6px、升到 elevation-4（阴影在 after 上，只过渡 opacity）
const CLICKABLE =
  "relative block w-full cursor-pointer text-left transition-transform duration-base " +
  "hover:-translate-y-1.5 after:pointer-events-none after:absolute after:inset-0 " +
  "after:rounded-card after:shadow-e4 after:opacity-0 after:transition-opacity " +
  "after:duration-base hover:after:opacity-100";

export type CardProps = Readonly<{
  children: ReactNode;
  className?: string;
  /** 传入后整张卡片是 <button>。按钮内只能放行内内容（span、strong），不要放 div / h3。 */
  onClick?: () => void;
  /** 传入后整张卡片是 <a>，可以放任意块级内容。和 onClick 二选一。 */
  href?: string;
}>;

export function Card({ children, className, onClick, href }: CardProps) {
  if (href) {
    return (
      <a href={href} className={cn(SURFACE, "text-ink no-underline shadow-e2", CLICKABLE, className)}>
        {children}
      </a>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(SURFACE, "shadow-e2", CLICKABLE, className)}>
        {children}
      </button>
    );
  }
  return <div className={cn(SURFACE, "shadow-e2", className)}>{children}</div>;
}

export type PanelProps = Readonly<{
  children: ReactNode;
  className?: string;
  /** 面板的可访问名称；给了就渲染为 <section aria-label>，否则是 <div> */
  label?: string;
}>;

export function Panel({ children, className, label }: PanelProps) {
  const classes = cn(SURFACE, "grid gap-6 shadow-e3", className);
  if (label) {
    return (
      <section aria-label={label} className={classes}>
        {children}
      </section>
    );
  }
  return <div className={classes}>{children}</div>;
}
