import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// badge：DESIGN.md §6.4。
// 左侧圆点用 currentColor；规范写 7px，按 §10 的 4px 刻度取整为 8px（h-2 w-2）。

export type BadgeTone = "soft" | "dark";

export type BadgeProps = Readonly<{
  children: ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
}>;

const TONES: Readonly<Record<BadgeTone, string>> = {
  soft: "bg-accent-soft text-accent-soft-ink",
  dark: "bg-ink text-accent-on",
};

export function Badge({ children, tone = "soft", dot = true, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-pill px-3 py-1 font-body text-sm font-semibold shadow-e1",
        TONES[tone],
        className,
      )}
    >
      {dot ? <span className="h-2 w-2 shrink-0 rounded-pill bg-current" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
