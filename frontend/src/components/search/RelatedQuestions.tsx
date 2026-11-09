"use client";

import { ArrowRight } from "lucide-react";

// F14：相关追问。related 事件下发 3–5 条，展示在研报末尾；
// 点击直接发起新检索（沿用当前 focusMode / scopeFilters / engine）。
// 事件缺失或为空时不显示。

export type RelatedQuestionsProps = Readonly<{
  items: ReadonlyArray<string>;
  onSelect: (question: string) => void;
}>;

export function RelatedQuestions({ items, onSelect }: RelatedQuestionsProps) {
  if (items.length === 0) return null;
  return (
    <section aria-label="相关追问" className="rounded-card bg-surface px-6 py-5 shadow-e2">
      <h2 className="font-display text-lg font-bold text-ink">相关追问</h2>
      <ul className="mt-3 grid gap-2">
        {items.map((q) => (
          <li key={q}>
            <button
              type="button"
              onClick={() => onSelect(q)}
              className="group flex w-full cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left text-ui font-semibold text-accent-deep transition-colors duration-fast hover:bg-accent-tint-hover"
            >
              <span className="min-w-0 break-words">{q}</span>
              <ArrowRight size={16} aria-hidden="true" className="shrink-0 opacity-0 transition-opacity duration-fast group-hover:opacity-100" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
