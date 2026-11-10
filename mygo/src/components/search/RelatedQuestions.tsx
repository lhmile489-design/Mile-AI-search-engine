
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
    <section aria-label="相关追问" className="mt-4">
      <h3 className="msg-section-title">相关追问</h3>
      <ul className="grid gap-2">
        {items.map((q, i) => (
          <li key={q}>
            <button type="button" onClick={() => onSelect(q)} className="evidence-row group">
              <span className="num-dot" aria-hidden="true">
                {i + 1}
              </span>
              <span className="evidence-row-title min-w-0 flex-1">{q}</span>
              <ArrowRight size={14} aria-hidden="true" className="mt-1 shrink-0 text-accent-deep opacity-0 transition-opacity duration-fast group-hover:opacity-100" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
