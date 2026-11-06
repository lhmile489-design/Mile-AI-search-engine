import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

// 按钮：DESIGN.md §6.1。
// 悬停的底色和阴影变化放在伪元素上，只过渡 opacity（§8）：
//   before = 目标底色层，after = 目标阴影层。
// 按钮自身 isolate 建立层叠上下文，-z-10 的伪元素画在按钮底色之上、文字之下。

export type ButtonVariant = "primary" | "secondary" | "ghost";

type BaseProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className"> & {
  variant?: ButtonVariant;
  icon?: LucideIcon;
  className?: string;
};

// 只有图标的按钮必须带 aria-label（§6.1）
type WithText = BaseProps & { children: ReactNode };
type IconOnly = BaseProps & { children?: undefined; "aria-label": string };

export type ButtonProps = Readonly<WithText | IconOnly>;

const BASE =
  "relative isolate inline-flex shrink-0 select-none items-center justify-center gap-2 " +
  "rounded-md font-body text-ui font-semibold transition-transform duration-fast";

const LAYERS =
  "before:absolute before:inset-0 before:-z-10 before:rounded-md before:opacity-0 " +
  "before:transition-opacity before:duration-fast " +
  "after:absolute after:inset-0 after:-z-10 after:rounded-md after:opacity-0 " +
  "after:transition-opacity after:duration-fast";

const VARIANTS: Readonly<Record<ButtonVariant, string>> = {
  primary:
    "bg-accent text-accent-on shadow-accent-rest before:bg-accent-deep after:shadow-accent-hover " +
    "hover:-translate-y-0.5 hover:before:opacity-100 hover:after:opacity-100 " +
    // 按下：回到原位、切到 --shadow-accent-press（阴影直接切换，不做过渡）
    "active:translate-y-0 active:shadow-accent-press active:after:opacity-0",
  secondary:
    "border border-line bg-surface text-ink shadow-e1 after:shadow-e3 " +
    "hover:-translate-y-0.5 hover:after:opacity-100 active:translate-y-0 active:after:opacity-0",
  ghost:
    "bg-transparent text-accent-deep before:bg-accent-tint-hover after:bg-accent-tint-press " +
    // 按下时只显示 press 层，避免 hover 层叠加
    "hover:before:opacity-100 active:before:opacity-0 active:after:opacity-100",
};

// 停用：无阴影、不位移、不挂伪元素层
const DISABLED = "cursor-not-allowed bg-disabled text-ink-faint";

export function Button({
  variant = "primary",
  icon: Icon,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  const iconOnly = children === undefined;
  return (
    <button
      type={type}
      disabled={disabled}
      className={cn(
        BASE,
        // 图标按钮点击区域 40x40（§6.1）
        iconOnly ? "h-10 w-10" : "px-6 py-3",
        disabled ? DISABLED : cn("cursor-pointer", LAYERS, VARIANTS[variant]),
        className,
      )}
      {...rest}
    >
      {Icon ? <Icon size={iconOnly ? 20 : 16} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
