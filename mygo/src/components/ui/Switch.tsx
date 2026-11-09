import { cn } from "@/lib/cn";

// 开关：DESIGN.md §6.5。
// 原生 <input type="checkbox" role="switch"> 视觉隐藏但保留可聚焦，后面的 span 是轨道（peer 写法）。
// 不在 input 上挂伪元素：部分浏览器不渲染 input 的 ::before / ::after。
//   轨道 before = 开启态的 --accent 底色层（只过渡 opacity）
//   轨道 after  = 白色滑块（只过渡 transform）
// 焦点环画在轨道上：ring 默认宽 3px，与全站 :focus-visible 的 3px outline 一致。
// 尺寸按 §10 的 4px 刻度取整：轨道 50x28 -> 48x28，滑块 22 -> 20，位移 22 -> 20。

export type SwitchProps = Readonly<{
  label: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  className?: string;
}>;

const TRACK =
  "relative h-7 w-12 shrink-0 rounded-pill bg-track-off shadow-inset-track " +
  "peer-focus-visible:ring peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2 " +
  "before:absolute before:inset-0 before:rounded-pill before:bg-accent before:opacity-0 " +
  "before:transition-opacity before:duration-fast peer-checked:before:opacity-100 " +
  "after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-pill " +
  "after:bg-surface after:shadow-e2 after:transition-transform after:duration-fast " +
  "peer-checked:after:translate-x-5";

export function Switch({ label, checked, onCheckedChange, disabled, className }: SwitchProps) {
  return (
    <label
      className={cn(
        "relative inline-flex items-center gap-3 font-body text-label font-semibold",
        disabled ? "cursor-not-allowed text-ink-faint" : "cursor-pointer text-ink",
        className,
      )}
    >
      <input
        type="checkbox"
        role="switch"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange(event.target.checked)}
      />
      <span className={TRACK} aria-hidden="true" />
      {label}
    </label>
  );
}
