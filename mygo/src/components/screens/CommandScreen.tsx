
import type { RefObject } from "react";
import { Search } from "lucide-react";
import { Chip } from "@/components/ui/Chip";
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
  return <kbd className="rounded-xs bg-surface px-2 py-0.5 font-mono text-xs text-ink shadow-e1">{children}</kbd>;
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
    <section aria-labelledby="brand-title" className="mx-auto w-full max-w-command px-5 pb-16 pt-12 md:pt-20">
      <div className="flex items-center gap-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-sm bg-accent text-accent-on shadow-e2">
          <Search size={16} aria-hidden="true" />
        </span>
        <h1 id="brand-title" className="font-display text-display font-bold leading-display">
          Mile AI Search
        </h1>
      </div>
      <p className="mt-4 max-w-lead text-base text-ink-soft">
        输入一个技术问题，得到带引用角标的研报。每个结论都能点回原文段落。
      </p>

      <div className="mt-8">
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
        <div className="mt-6">
          <h2 className="text-label font-semibold text-ink-soft">推荐问题</h2>
          <ul className="mt-3 flex flex-wrap gap-3">
            {suggestions.map((text) => (
              <li key={text} className="max-w-full">
                <Chip onClick={() => onSubmit(text)} className="max-w-full text-left">
                  <span className="truncate">{text}</span>
                </Chip>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-soft">
        <span><Kbd>Enter</Kbd> 提交</span>
        <span><Kbd>Shift+Enter</Kbd> 换行</span>
        <span><Kbd>Ctrl+K</Kbd> 聚焦搜索框</span>
        <span><Kbd>Ctrl+B</Kbd> 历史记录</span>
        <span><Kbd>Esc</Kbd> 停止检索</span>
      </p>
    </section>
  );
}
