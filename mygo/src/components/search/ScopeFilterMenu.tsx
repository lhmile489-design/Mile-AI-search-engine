
import { useEffect, useRef, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ConfigOption, SourceCategory } from "@/types";

// F21：Superbar 左侧 "+" 按钮，打开信源范围过滤菜单。
// 五类可多选，选项来自 /api/config.scopes，不写死。
// 菜单是 elevation-4 浮窗（DESIGN.md §3.1），实色底不用玻璃。

export type ScopeFilterMenuProps = Readonly<{
  scopes: ReadonlyArray<ConfigOption>;
  selected: ReadonlyArray<SourceCategory>;
  onChange: (next: ReadonlyArray<SourceCategory>) => void;
  /** 菜单向上弹出：结果页底部输入栏使用，避免被面板底边裁掉 */
  menuUp?: boolean;
}>;

export function ScopeFilterMenu({ scopes, selected, onChange, menuUp = false }: ScopeFilterMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const count = selected.length;

  const toggle = (value: string) => {
    const cat = value as SourceCategory;
    onChange(
      selected.includes(cat)
        ? selected.filter((item) => item !== cat)
        : [...selected, cat],
    );
  };

  // 点击菜单外部 / Esc 关闭
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

  if (scopes.length === 0) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="信源范围过滤"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn("mode-chip", count > 0 && "is-active")}
      >
        <Plus size={12} strokeWidth={2.5} aria-hidden="true" />
        {count > 0 ? `范围 ${count}` : "范围"}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="信源范围"
          className={cn(
            "absolute left-0 z-drawer w-64 rounded-card border border-line bg-surface p-2 shadow-e4",
            menuUp ? "bottom-full mb-2" : "top-full mt-2",
          )}
        >
          <div className="flex items-center justify-between px-3 py-2">
            <p className="text-label font-semibold text-ink">信源范围</p>
            {count > 0 ? (
              <button
                type="button"
                onClick={() => onChange([])}
                className="inline-flex cursor-pointer items-center gap-1 text-sm font-semibold text-accent-deep hover:underline"
              >
                <X size={14} aria-hidden="true" />
                清除全部
              </button>
            ) : null}
          </div>
          <ul>
            {scopes.map((scope) => {
              const checked = selected.includes(scope.value as SourceCategory);
              return (
                <li key={scope.value}>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={checked}
                    onClick={() => toggle(scope.value)}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-left transition-colors duration-fast hover:bg-accent-tint-hover"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-xs border",
                        checked ? "border-accent bg-accent text-accent-on" : "border-line-input bg-surface",
                      )}
                    >
                      {checked ? <Check size={14} aria-hidden="true" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-ui font-semibold text-ink">{scope.label}</span>
                      {scope.description ? (
                        <span className="mt-0.5 block text-sm text-ink-muted">{scope.description}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="border-t border-line px-3 pb-1 pt-2 text-sm text-ink-muted">
            {count === 0 ? "不限制信源类别" : `已选 ${count} 类，其余类别的信源将被排除`}
          </p>
        </div>
      ) : null}
    </div>
  );
}
