
import type { RefObject } from "react";
import logoUrl from "@/assets/appLogo.png";
import { Superbar } from "@/components/search/Superbar";
import type { AppConfig, FocusMode, SourceCategory } from "@/types";

// 屏幕 1：首屏命令台（PRODUCT.md §4.1）。内容只有三样：品牌、Superbar、推荐问题。
// 快捷键说明用小字展示一次，不弹窗（§6）。

export type CommandScreenProps = Readonly<{
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: (query?: string) => void;
  suggestions: ReadonlyArray<string>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  blockedReason: string | null;
  /** 有 blockedReason 时显示「去设置」入口（PRODUCT.md §8） */
  onOpenSettings?: () => void;
  config: AppConfig | null;
  focusMode: FocusMode;
  scopeFilters: ReadonlyArray<SourceCategory>;
  engine: string | null;
  onFocusModeChange: (mode: FocusMode) => void;
  onScopeFiltersChange: (next: ReadonlyArray<SourceCategory>) => void;
  onEngineChange: (engine: string) => void;
}>;

function Kbd({ children }: Readonly<{ children: string }>) {
  return <kbd className="kbd">{children}</kbd>;
}

export function CommandScreen({
  draft,
  onDraftChange,
  onSubmit,
  suggestions,
  inputRef,
  blockedReason,
  onOpenSettings,
  config,
  focusMode,
  scopeFilters,
  engine,
  onFocusModeChange,
  onScopeFiltersChange,
  onEngineChange,
}: CommandScreenProps) {
  return (
    <section
      aria-labelledby="brand-title"
      className="command-screen mx-auto flex w-full max-w-hero flex-col items-center justify-center px-6 py-12 text-center"
    >
      <img src={logoUrl} alt="" className="mb-5 h-hero-icon w-hero-icon object-contain" />
      <h1 id="brand-title" className="mb-4 font-display text-display font-bold leading-display tracking-tight">
        Mile AI Search
      </h1>
      <p className="mx-auto max-w-hero-desc text-base text-ink-soft">
        输入技术问题，得到带引用角标的研报。每个结论都能追溯到原文段落。
      </p>

      <div className="mt-8 w-full text-left">
        <Superbar
          value={draft}
          onChange={onDraftChange}
          onSubmit={() => onSubmit()}
          inputRef={inputRef}
          autoFocus
          blockedReason={blockedReason}
          config={config}
          focusMode={focusMode}
          scopeFilters={scopeFilters}
          engine={engine}
          onFocusModeChange={onFocusModeChange}
          onScopeFiltersChange={onScopeFiltersChange}
          onEngineChange={onEngineChange}
        />
        {blockedReason && onOpenSettings ? (
          <p className="mt-3 text-sm text-ink-soft">
            <button type="button" onClick={onOpenSettings} className="font-semibold text-accent-deep underline">
              去设置
            </button>
            ，填入密钥后即可开始检索。
          </p>
        ) : null}
      </div>

      {suggestions.length > 0 ? (
        <div className="mt-6 w-full">
          <h2 className="sr-only">推荐问题</h2>
          <ul className="flex flex-wrap justify-center gap-3">
            {suggestions.map((text) => (
              <li key={text} className="max-w-full">
                <button type="button" onClick={() => onSubmit(text)} className="suggestion-chip text-left">
                  <span className="truncate">{text}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-ink-faint">
        <span><Kbd>Enter</Kbd> 提交</span>
        <span><Kbd>Shift+Enter</Kbd> 换行</span>
        <span><Kbd>Ctrl+K</Kbd> 聚焦搜索框</span>
        <span><Kbd>Ctrl+B</Kbd> 历史记录</span>
        <span><Kbd>Esc</Kbd> 停止检索</span>
      </p>
    </section>
  );
}
