import { useCallback, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  PRESETS,
  applyTheme,
  customHexOf,
  loadTheme,
  saveTheme,
  swatchOf,
  type ThemeId,
} from "@/lib/theme";

// 主题色选择器（UI 改版稿 .theme-picker）：34px 圆形触发按钮 + 下拉面板。
// 圆点颜色是运行时按主题算出的值，只能走 CSS 变量 --swatch，不在源码里写 hex。

function Dot({ color, rainbow = false }: Readonly<{ color?: string; rainbow?: boolean }>) {
  return (
    <span
      aria-hidden="true"
      className={cn("h-3.5 w-3.5 shrink-0 rounded-pill", rainbow ? "theme-rainbow" : "swatch-fill")}
      style={color ? ({ "--swatch": color } as React.CSSProperties) : undefined}
    />
  );
}

export function ThemePicker() {
  const [theme, setTheme] = useState<ThemeId>(() => loadTheme());
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const colorRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const choose = useCallback((next: ThemeId) => {
    setTheme(next);
    saveTheme(next);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const custom = customHexOf(theme);

  return (
    <div ref={rootRef} className="relative mr-2">
      <button
        type="button"
        aria-label="主题色"
        aria-haspopup="true"
        aria-expanded={open}
        title="主题色"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-control w-control cursor-pointer items-center justify-center rounded-pill border border-line bg-surface shadow-e1 transition duration-fast hover:-translate-y-px hover:shadow-e3"
      >
        <span
          aria-hidden="true"
          className="h-4 w-4 rounded-pill swatch-fill theme-dot-ring"
          style={{ "--swatch": swatchOf(theme) } as React.CSSProperties}
        />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="主题色"
          className="theme-drop-in absolute right-0 top-full mt-2 z-modal flex w-48 flex-col gap-0.5 rounded-card border border-line bg-surface p-3 shadow-e4"
        >
          <div className="px-2 pb-2 text-xs font-bold uppercase tracking-meta text-ink-faint">主题色</div>
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              role="menuitemradio"
              aria-checked={theme === preset.id}
              onClick={() => {
                choose(preset.id);
                setOpen(false);
              }}
              className="flex w-full cursor-pointer items-center gap-2 rounded-md p-2 text-left text-sm font-medium text-ink-soft transition-colors duration-fast hover:bg-accent-tint-hover hover:text-ink"
            >
              <Dot color={preset.hex} />
              <span className="flex-1">{preset.label}</span>
              {theme === preset.id ? <Check size={12} strokeWidth={3.2} className="text-accent" aria-hidden="true" /> : null}
            </button>
          ))}
          <div className="my-2 h-px bg-line" />
          <button
            type="button"
            role="menuitemradio"
            aria-checked={custom !== null}
            onClick={() => colorRef.current?.click()}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md p-2 text-left text-sm font-medium text-ink-soft transition-colors duration-fast hover:bg-accent-tint-hover hover:text-ink"
          >
            <Dot rainbow />
            <span className="flex-1">{custom ? `自定义 ${custom.toUpperCase()}` : "自定义颜色"}</span>
            {custom ? <Check size={12} strokeWidth={3.2} className="text-accent" aria-hidden="true" /> : null}
          </button>
          <input
            ref={colorRef}
            type="color"
            aria-label="自定义主题色"
            value={custom ?? swatchOf(theme)}
            onChange={(event) => choose(`custom:${event.target.value.toUpperCase()}` as ThemeId)}
            className="pointer-events-none absolute h-px w-px opacity-0"
          />
        </div>
      ) : null}
    </div>
  );
}
