
import { Suspense, lazy, useDeferredValue, useMemo } from "react";
import { TriangleAlert } from "lucide-react";
import type { ActiveMarker, FenceRenderer } from "./MarkdownRenderer";
import { OpenUiCard } from "./openui/OpenUiCard";

// 研报面板：elevation-2，行宽 --measure（DESIGN.md §7）。
// Markdown 渲染组件体积大，用 React.lazy 分包懒加载（PRODUCT.md §9）。

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

const MarkdownRenderer = lazy(() => import("./MarkdownRenderer"));

export type ReportViewProps = Readonly<{
  report: string;
  generating: boolean;
  aborted: boolean;
  maxCitation: number;
  activeCitation: ActiveMarker | null;
  onCite: (index: number, markerStart: number | null) => void;
  /** 点正文空白处取消高亮 */
  onClear?: () => void;
}>;

export function ReportView({ report, generating, aborted, maxCitation, activeCitation, onCite, onClear }: ReportViewProps) {
  // 低优先级渲染：流式追加时输入框、按钮等交互不被整篇重渲染拖慢
  const text = useDeferredValue(report);

  // openui-lang 围栏块交给 OpenUiCard 渲染。卡片内 [n] 角标沿用正文的点击回调
  // （markerStart 无法定位 —— OpenUI 卡片的角标不在原始 markdown 文本里，传 null 只定位卡片）。
  const fenceRenderers = useMemo<Readonly<Record<string, FenceRenderer>>>(
    () => ({
      "openui-lang": ({ code }) => (
        <OpenUiCard code={code} language="openui-lang" maxCitation={maxCitation} onCite={(index) => onCite(index, null)} />
      ),
    }),
    [maxCitation, onCite],
  );
  return (
    <article
      aria-label="研报正文"
      aria-busy={generating}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("button,a")) onClear?.();
      }}
      className="min-w-0">
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
        <Suspense fallback={<ReportSkeleton />}>
          <MarkdownRenderer
            text={text}
            maxCitation={maxCitation}
            activeCitation={activeCitation}
            onCite={onCite}
            fenceRenderers={fenceRenderers}
          />
        </Suspense>
      ) : generating ? (
        <ReportSkeleton />
      ) : (
        <p className="text-ui text-ink-soft">本次没有生成正文。</p>
      )}
    </article>
  );
}
