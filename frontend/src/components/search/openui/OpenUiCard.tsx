"use client";

import { useMemo, useState } from "react";
import { createParser, type ElementNode } from "@openuidev/react-lang";
import { Code2, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { openUILibrary, unwrapOpenUi } from "@/lib/openui";
import { BenchmarkCardView, type BenchmarkCardViewProps } from "./BenchmarkCardView";
import { PipelineClockView, type PipelineClockViewProps } from "./PipelineClockView";

// openui-lang 围栏渲染器（F11）。
// 每个围栏块独立解析，不走 OpenUI 的 <Renderer> —— 那样卡片里的 [n] 角标
// 点击回调传不进自己的视图组件，而且这些组件各自有排序/展开状态。
// 解析出的 root 是 ElementNode 树（嵌套 props 也是 element），
// 交给 BenchmarkCardView / PipelineClockView 前先用 unwrapOpenUi 解成纯 props。

const parser = createParser(openUILibrary.toJSONSchema());

export type OpenUiCardProps = Readonly<{
  code: string;
  language: string;
  maxCitation: number;
  onCite: (index: number) => void;
}>;

type ViewTab = "card" | "source";

function renderNode(
  node: ElementNode | null,
  maxCitation: number,
  onCite: (index: number) => void,
): React.ReactNode {
  if (!node) return null;
  const props = unwrapOpenUi(node.props) as Record<string, unknown>;
  if (node.typeName === "HardwareBenchmarkCard") {
    return <BenchmarkCardView {...(props as unknown as BenchmarkCardViewProps)} maxCitation={maxCitation} onCite={onCite} />;
  }
  if (node.typeName === "PipelineClockCard") {
    return <PipelineClockView {...(props as unknown as PipelineClockViewProps)} maxCitation={maxCitation} onCite={onCite} />;
  }
  return null;
}

export function OpenUiCard({ code, maxCitation, onCite }: OpenUiCardProps) {
  const [view, setView] = useState<ViewTab>("card");
  const result = useMemo(() => {
    try {
      return parser.parse(code);
    } catch {
      return null;
    }
  }, [code]);

  const errors = result?.meta.errors ?? [];
  const failed = !result || result.root === null || errors.length > 0;
  const incomplete = result?.meta.incomplete ?? false;

  // 解析失败（root 为 null 或字段校验报错）：一律降级 DSL 源码视图并说明原因。
  if (failed) {
    const reason = !result
      ? "DSL 无法解析"
      : result.root === null
        ? "未识别到卡片定义"
        : `校验失败：${errors[0]?.message ?? "字段不合规"}`;
    return (
      <figure className="my-4 overflow-hidden rounded-card bg-surface-sunk shadow-e2">
        <figcaption className="flex items-center gap-2 border-b border-line px-4 py-2 text-sm text-ink-muted">
          <Code2 size={15} aria-hidden="true" />
          交互卡片{reason ? `（${reason}，显示 DSL 源码）` : ""}
        </figcaption>
        <pre className="overflow-x-auto px-4 py-3 font-mono text-sm leading-body text-ink-soft"><code>{code}</code></pre>
      </figure>
    );
  }

  const card = renderNode(result.root, maxCitation, onCite);

  return (
    <figure className="my-4">
      <div
        role="group"
        aria-label="卡片视图切换"
        className="mb-2 inline-flex rounded-pill bg-surface-sunk p-0.5"
      >
        {(["card", "source"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            aria-pressed={view === tab}
            onClick={() => setView(tab)}
            className={cn(
              "cursor-pointer rounded-pill px-3 py-1 text-label font-semibold transition-colors duration-fast",
              view === tab ? "bg-surface text-ink shadow-e1" : "text-ink-muted hover:text-ink",
            )}
          >
            {tab === "card" ? "交互视图" : "DSL 源码"}
          </button>
        ))}
      </div>
      {view === "source" ? (
        <pre className="overflow-x-auto rounded-card bg-surface-sunk px-4 py-3 font-mono text-sm leading-body text-ink-soft shadow-e2"><code>{code}</code></pre>
      ) : card ? (
        <>
          {card}
          {incomplete ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-label text-ink-muted" role="status">
              <Loader2 size={12} aria-hidden="true" className="animate-spin" />
              卡片内容仍在生成中…
            </p>
          ) : null}
        </>
      ) : incomplete ? (
        <div className="flex items-center gap-2 rounded-card bg-surface px-6 py-5 text-ui text-ink-muted shadow-e2" role="status">
          <Loader2 size={16} aria-hidden="true" className="animate-spin" />
          正在生成交互卡片…
        </div>
      ) : (
        <pre className="overflow-x-auto rounded-card bg-surface-sunk px-4 py-3 font-mono text-sm leading-body text-ink-soft shadow-e2"><code>{code}</code></pre>
      )}
    </figure>
  );
}
