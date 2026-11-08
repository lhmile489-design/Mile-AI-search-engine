"use client";

import { useEffect, type KeyboardEvent, type RefObject } from "react";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { MAX_QUERY_LENGTH, queryLength } from "@/store/useSearchController";

// Superbar：DESIGN.md §6.2。多行输入，Enter 提交，Shift+Enter 换行。
// 去首尾空白后 1-500 字符；超长要有提示，空问题时提交按钮停用。

export type SuperbarProps = Readonly<{
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** 紧凑样式：结果页顶部使用，海拔降为 elevation-2 */
  compact?: boolean;
  autoFocus?: boolean;
  label?: string;
  placeholder?: string;
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
}: SuperbarProps) {
  const length = queryLength(value);
  const tooLong = length > MAX_QUERY_LENGTH;
  const canSubmit = length >= 1 && !tooLong;

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

  return (
    <form
      className={cn(
        "rounded-card bg-surface p-4 focus-within:shadow-focus-soft",
        compact ? "shadow-e2" : "shadow-e3",
      )}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit();
      }}
    >
      <textarea
        ref={inputRef}
        value={value}
        rows={compact ? 1 : 2}
        aria-label={label}
        aria-invalid={tooLong}
        aria-describedby={tooLong ? "superbar-limit" : undefined}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        className="max-h-48 w-full resize-none bg-transparent px-1 py-1 font-body text-base text-ink placeholder:text-ink-faint focus:outline-none"
      />
      <div className={cn("flex items-center justify-between gap-3", compact ? "mt-1" : "mt-2")}>
        <p
          id="superbar-limit"
          className={cn("text-sm", tooLong ? "font-semibold text-danger" : "text-ink-muted", compact && !tooLong && "sr-only")}
          role={tooLong ? "alert" : undefined}
        >
          {tooLong ? `问题最多 ${MAX_QUERY_LENGTH} 个字符，当前 ${length} 个，请精简后再提交` : "Enter 提交，Shift+Enter 换行"}
        </p>
        <Button type="submit" icon={ArrowUp} disabled={!canSubmit} aria-label="提交检索" className={compact ? "ml-auto" : undefined} />
      </div>
    </form>
  );
}
