
import { CITATION_PATTERN } from "@/lib/citations";
import type { CardTextProps } from "./types";

// OpenUI 卡片内文本的 [n] 角标切分。
// 与正文同一套行为：编号在 [1, maxCitation] 内渲染为按钮，超出按纯文本。

export function CitationText({ text, maxCitation, onCite }: CardTextProps & Readonly<{ text: string }>) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const match of text.matchAll(CITATION_PATTERN)) {
    const index = Number(match[1]);
    const at = match.index ?? 0;
    if (at > cursor) {
      key += 1;
      parts.push(<span key={key}>{text.slice(cursor, at)}</span>);
    }
    if (Number.isSafeInteger(index) && index >= 1 && index <= maxCitation) {
      key += 1;
      parts.push(
        <button
          key={key}
          type="button"
          aria-label={`查看第 ${index} 个信源`}
          onClick={() => onCite(index)}
          className="mx-0.5 inline-block min-w-5 cursor-pointer rounded-xs bg-accent-soft px-1 text-center align-baseline font-body text-xs font-bold leading-snug text-accent-soft-ink hover:bg-accent-tint-press"
        >
          {index}
        </button>,
      );
    } else {
      key += 1;
      parts.push(<span key={key}>{match[0]}</span>);
    }
    cursor = at + match[0].length;
  }
  if (cursor < text.length) {
    key += 1;
    parts.push(<span key={key}>{text.slice(cursor)}</span>);
  }
  return <>{parts}</>;
}
