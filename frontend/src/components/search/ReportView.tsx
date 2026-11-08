"use client";

import { useDeferredValue } from "react";
import dynamic from "next/dynamic";
import { TriangleAlert } from "lucide-react";
import type { ActiveMarker } from "./MarkdownRenderer";

// 研报面板：elevation-2，行宽 --measure（DESIGN.md §7）。
// Markdown 渲染组件体积大，用 next/dynamic 懒加载（PRODUCT.md §9）。

function ReportSkeleton() {
  return (
    <div aria-hidden="true" className="grid gap-3">
      <div className="h-6 w-1/2 rounded-xs bg-surface-sunk" />
      <div className="h-4 w-full rounded-xs bg-surface-sunk" />
      <div className="h-4 w-5/6 rounded-xs bg-surface-sunk" />
      <div className="h-4 w-2/3 rounded-xs bg-surface-sunk" />
    </div>
  );
}

const MarkdownRenderer = dynamic(() => import("./MarkdownRenderer"), {
  ssr: false,
  loading: () => <ReportSkeleton />,
});

export type ReportViewProps = Readonly<{
  report: string;
  generating: boolean;
  aborted: boolean;
  maxCitation: number;
  activeCitation: ActiveMarker | null;
  onCite: (index: number, markerStart: number | null) => void;
}>;

export function ReportView({ report, generating, aborted, maxCitation, activeCitation, onCite }: ReportViewProps) {
  // 低优先级渲染：流式追加时输入框、按钮等交互不被整篇重渲染拖慢
  const text = useDeferredValue(report);
  return (
    <article aria-label="研报正文" aria-busy={generating} className="rounded-card bg-surface px-6 py-7 shadow-e2">
      {aborted ? (
        <p
          role="status"
          className="mb-4 flex items-center gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm font-semibold text-warning"
        >
          <TriangleAlert size={16} aria-hidden="true" />
          已中止：以下是中止前已生成的内容
        </p>
      ) : null}
      {text ? (
        <MarkdownRenderer
          text={text}
          maxCitation={maxCitation}
          activeCitation={activeCitation}
          onCite={onCite}
        />
      ) : generating ? (
        <ReportSkeleton />
      ) : (
        <p className="text-ui text-ink-soft">本次没有生成正文。</p>
      )}
    </article>
  );
}
