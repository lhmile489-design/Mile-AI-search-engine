import type { Consensus } from "@/types";

// F25：共识度小胶囊（UI 改版稿 tab-strip 右侧）。score 为 null 时不显示（决策 D4：不写占位值）。
// 计数口径「N 句中 M 句有多源支持」放在 title 与读屏文本里，不写固定文案。

export type ConsensusBadgeProps = Readonly<{
  consensus: Consensus | null;
}>;

export function ConsensusBadge({ consensus }: ConsensusBadgeProps) {
  if (!consensus || consensus.score === null) return null;
  const pct = Math.round(consensus.score * 100);
  const detail = `${consensus.citedSentences} 句中 ${consensus.supportedSentences} 句有多源支持`;
  return (
    <span role="status" title={detail} className="consensus-pill">
      共识度 {pct}%
      <span className="sr-only">，{detail}</span>
    </span>
  );
}
