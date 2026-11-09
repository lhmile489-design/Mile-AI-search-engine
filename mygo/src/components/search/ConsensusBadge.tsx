import type { Consensus } from "@/types";

// F25：共识度。score 为 null 时不显示（决策 D4：不写占位值）。
// 显示时附带计数口径：「N 句中 M 句有多源支持」，不写固定文案。

export type ConsensusBadgeProps = Readonly<{
  consensus: Consensus | null;
}>;

export function ConsensusBadge({ consensus }: ConsensusBadgeProps) {
  if (!consensus || consensus.score === null) return null;
  const pct = Math.round(consensus.score * 100);
  return (
    <span
      role="status"
      title={`${consensus.citedSentences} 句中有 ${consensus.supportedSentences} 句有多源支持`}
      className="inline-flex items-center gap-2 rounded-pill bg-success-soft px-3 py-1 font-body text-sm font-semibold text-success shadow-e1"
    >
      <span className="h-2 w-2 rounded-pill bg-success" aria-hidden="true" />
      共识度 {pct}%
      <span className="font-normal text-ink-muted">
        {consensus.citedSentences} 句中 {consensus.supportedSentences} 句有多源支持
      </span>
    </span>
  );
}
