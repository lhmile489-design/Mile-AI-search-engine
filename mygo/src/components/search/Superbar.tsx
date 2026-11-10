
import { useEffect, type KeyboardEvent, type RefObject } from "react";
import { Send } from "lucide-react";
import { cn } from "@/lib/cn";
import { MAX_QUERY_LENGTH, queryLength } from "@/store/useSearchController";
import type { AppConfig, FocusMode, SourceCategory } from "@/types";
import { EnginePicker, FocusModePicker } from "./SearchPickers";
import { ScopeFilterMenu } from "./ScopeFilterMenu";

// Superbar：DESIGN.md §6.2。多行输入，Enter 提交，Shift+Enter 换行。
// 去首尾空白后 1-500 字符；超长要有提示，空问题时提交按钮停用。
// 两种形态对齐 docs/ui-redesign-preview.html：
//   默认  = 首屏 .command-superbar（无聚焦光环，底部下沉栏放模式 chip 与引擎）
//   compact = 结果页底部 .input-bar（下沉输入行 + 34px 发送按钮，下方一行模式 chip 与快捷键提示）

export type SuperbarProps = Readonly<{
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** 结果页底部输入栏形态 */
  compact?: boolean;
  autoFocus?: boolean;
  label?: string;
  placeholder?: string;
  /** 不能提交的原因（例如没有可用的检索引擎）。有值时提交按钮停用并显示该提示。 */
  blockedReason?: string | null;

  // F15 / F21 / F22：检索参数控件。config 为 null（/api/config 还没拿到）时整块不显示。
  config?: AppConfig | null;
  focusMode?: FocusMode;
  scopeFilters?: ReadonlyArray<SourceCategory>;
  engine?: string | null;
  onFocusModeChange?: (mode: FocusMode) => void;
  onScopeFiltersChange?: (next: ReadonlyArray<SourceCategory>) => void;
  onEngineChange?: (engine: string) => void;
}>;

export function Superbar({
  value,
  onChange,
  onSubmit,
  inputRef,
  compact = false,
  autoFocus = false,
  label = "输入技术问题",
  placeholder = "输入一个技术问题，例如：FlashAttention-3 FP8 内核吞吐基准",
  blockedReason = null,
  config = null,
  focusMode = "web",
  scopeFilters = [],
  engine = null,
  onFocusModeChange,
  onScopeFiltersChange,
  onEngineChange,
}: SuperbarProps) {
  const length = queryLength(value);
  const tooLong = length > MAX_QUERY_LENGTH;
  const blocked = blockedReason !== null;
  const canSubmit = length >= 1 && !tooLong && !blocked;
  const hasError = tooLong || blocked;

  // 自动增高：先清掉旧高度再按 scrollHeight 设置
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, inputRef]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus, inputRef]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    // 输入法选词时的回车不是提交
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (canSubmit) onSubmit();
  };

  const message = blocked
    ? blockedReason
    : tooLong
      ? `问题最多 ${MAX_QUERY_LENGTH} 个字符，当前 ${length} 个，请精简后再提交`
      : null;

  const scope =
    config && onScopeFiltersChange ? (
      <ScopeFilterMenu scopes={config.scopes} selected={scopeFilters} onChange={onScopeFiltersChange} menuUp={compact} />
    ) : null;
  const modes =
    config && onFocusModeChange ? (
      <FocusModePicker focusModes={config.focusModes} value={focusMode} onChange={onFocusModeChange} />
    ) : null;
  const engines =
    config && onEngineChange ? <EnginePicker engines={config.engines} value={engine} onChange={onEngineChange} /> : null;

  const textarea = (
    <textarea
      ref={inputRef}
      value={value}
      rows={compact ? 1 : 2}
      aria-label={label}
      aria-invalid={tooLong}
      aria-describedby="superbar-limit"
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={handleKeyDown}
      className={cn(
        "w-full flex-1 resize-none bg-transparent font-body leading-normal text-ink placeholder:text-ink-faint focus:outline-none focus-visible:outline-none",
        compact ? "max-h-32 py-1 text-ui" : "max-h-48 min-h-16 text-base",
      )}
    />
  );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (canSubmit) onSubmit();
  };

  if (compact) {
    return (
      <form className="w-full" onSubmit={submit}>
        <div className="input-row">
          {textarea}
          <button type="submit" disabled={!canSubmit} aria-label="提交检索" className="input-send-btn">
            <Send size={15} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </div>
        <div className="input-bar-meta">
          {scope}
          {modes}
          <p
            id="superbar-limit"
            role={hasError ? "alert" : undefined}
            className={cn("ml-auto text-xs", hasError ? "font-semibold text-danger" : "text-ink-faint")}
          >
            {message ?? (
              <>
                <kbd className="kbd">Enter</kbd> 发送 <kbd className="kbd ml-2">Shift+Enter</kbd> 换行
              </>
            )}
          </p>
          {engines}
        </div>
      </form>
    );
  }

  return (
    <form className="command-superbar" onSubmit={submit}>
      <div className="flex items-end gap-3 px-5 py-4">
        {textarea}
        <button
          type="submit"
          disabled={!canSubmit}
          aria-label="提交检索"
          className="inline-flex h-11 flex-shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md bg-accent px-5 text-ui font-semibold text-accent-on shadow-accent-rest transition duration-fast hover:-translate-y-0.5 hover:shadow-accent-hover active:translate-y-0 active:shadow-accent-press disabled:cursor-not-allowed disabled:translate-y-0 disabled:bg-disabled disabled:text-ink-faint disabled:shadow-none"
        >
          <Send size={16} aria-hidden="true" />
          检索
        </button>
      </div>
      <div className="command-superbar-footer">
        {scope}
        {modes}
        <span className="flex-1" />
        <p
          id="superbar-limit"
          role={hasError ? "alert" : undefined}
          className={cn("text-xs", hasError ? "font-semibold text-danger" : "sr-only")}
        >
          {message ?? "Enter 提交，Shift+Enter 换行"}
        </p>
        {engines}
      </div>
    </form>
  );
}
