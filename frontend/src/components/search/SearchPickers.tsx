"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { ConfigOption, EngineOption, FocusMode } from "@/types";

// F15 + F22：Superbar 底部的两个选择器。
// 视觉：分段 chip 行，当前选中项 --accent-soft 底 + --accent-soft-ink 字。
// 选项全部来自 /api/config，不写死。

export type FocusModePickerProps = Readonly<{
  focusModes: ReadonlyArray<ConfigOption>;
  value: FocusMode;
  onChange: (mode: FocusMode) => void;
}>;

/** F15：web / academic / code 三段切换，放在 Superbar 内部左下角。 */
export function FocusModePicker({ focusModes, value, onChange }: FocusModePickerProps) {
  if (focusModes.length === 0) return null;
  return (
    <div role="radiogroup" aria-label="检索模式" className="flex items-center gap-1">
      {focusModes.map((mode) => {
        const active = mode.value === value;
        return (
          <button
            key={mode.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={mode.description}
            onClick={() => onChange(mode.value as FocusMode)}
            className={cn(
              "cursor-pointer rounded-pill px-3 py-1 text-label font-semibold transition-colors duration-fast",
              active
                ? "bg-accent-soft text-accent-soft-ink shadow-e1"
                : "text-ink-muted hover:text-ink",
            )}
          >
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}

export type EnginePickerProps = Readonly<{
  engines: ReadonlyArray<EngineOption>;
  /** 当前生效的引擎；未选过时由调用方传入 /api/config 的第一个可用引擎 */
  value: string | null;
  onChange: (engine: string) => void;
}>;

/** F22：右下角引擎下拉。只有一个引擎时仍显示当前引擎（不可点）。 */
export function EnginePicker({ engines, value, onChange }: EnginePickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = engines.find((e) => e.value === value) ?? engines[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  if (!current) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="搜索引擎"
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={engines.length <= 1}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex cursor-pointer items-center gap-1 rounded-pill px-3 py-1 text-label font-semibold",
          engines.length > 1
            ? "text-ink-soft transition-colors duration-fast hover:bg-accent-tint-hover hover:text-ink"
            : "cursor-default text-ink-muted",
        )}
      >
        {current.label}
        {engines.length > 1 ? (
          <ChevronDown size={14} aria-hidden="true" className={cn("transition-transform duration-fast", open && "rotate-180")} />
        ) : null}
      </button>
      {open && engines.length > 1 ? (
        <ul
          role="listbox"
          aria-label="搜索引擎"
          className="absolute bottom-full right-0 z-drawer mb-1 w-44 rounded-card border border-line bg-surface p-1 shadow-e4"
        >
          {engines.map((engine) => {
            const active = engine.value === (value ?? current.value);
            return (
              <li key={engine.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(engine.value);
                    setOpen(false);
                  }}
                  className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-ui font-semibold text-ink transition-colors duration-fast hover:bg-accent-tint-hover"
                >
                  {engine.label}
                  {active ? <Check size={16} aria-hidden="true" className="text-accent-deep" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
