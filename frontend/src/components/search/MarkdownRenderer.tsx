"use client";

import { createContext, memo, useContext, useMemo, type ComponentPropsWithoutRef, type ReactNode } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { PluggableList } from "unified";
import "katex/dist/katex.min.css";
import { cn } from "@/lib/cn";
import { remarkCitations } from "@/lib/citations";

// 研报 Markdown 渲染。由 ReportView 用 next/dynamic 懒加载（react-markdown + katex + highlight.js 体积大）。
// 流式期间每次都对累计文本整体渲染：增量边界可能切在 "[1" / "**" / 代码围栏中间，
// 只有整体解析才能得到正确结果；半截语法在下一帧补全后自然修正。

/** 围栏块渲染扩展点：M5 把 openui-lang 注册进来。未注册的语言按普通代码块显示。 */
export type FenceRenderer = (props: Readonly<{ code: string; language: string }>) => ReactNode;

export type MarkdownRendererProps = Readonly<{
  text: string;
  /** 已有信源数；[n] 超出 [1, max] 时按纯文本显示 */
  maxCitation: number;
  /** 当前被点击的角标：编号 + 它在原始 report 里的偏移，两者都一致的那一个角标才显示为激活 */
  activeCitation: ActiveMarker | null;
  /** markerStart 为该角标在原始 report 里的 UTF-16 偏移，识别不出时为 null */
  onCite: (index: number, markerStart: number | null) => void;
  fenceRenderers?: Readonly<Record<string, FenceRenderer>>;
}>;

type HastNode = { type: string; value?: string; children?: HastNode[]; properties?: { className?: string[] } };

function hastText(node: HastNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(hastText).join("");
}

export type ActiveMarker = Readonly<{ index: number; markerStart: number | null }>;

type CitationContextValue = Readonly<{
  active: ActiveMarker | null;
  onCite: (index: number, markerStart: number | null) => void;
}>;

// 角标的「当前激活」和点击回调通过 context 传入，而不是闭包进 components：
// components 里的组件类型必须保持稳定，否则每次点击角标都会让所有角标节点被卸载重建，
// 键盘焦点随之丢失（Esc 关闭抽屉后焦点无法回到角标）。
const CitationContext = createContext<CitationContextValue>({ active: null, onCite: () => {} });

function CitationBadge({ index, markerStart }: Readonly<{ index: number; markerStart: number | null }>) {
  const { active, onCite } = useContext(CitationContext);
  // 精确对应：编号和偏移都一致才是「被点击的那一个」，同一信源的其他角标不跟着亮
  const isActive = active !== null && active.index === index && active.markerStart === markerStart;
  return (
    <button
      type="button"
      aria-label={`查看第 ${index} 个信源`}
      aria-pressed={isActive}
      onClick={() => onCite(index, markerStart)}
      className={cn(
        "mx-0.5 inline-block min-w-5 cursor-pointer rounded-xs px-1 text-center align-baseline font-body text-xs font-bold leading-snug",
        isActive ? "bg-accent text-accent-on" : "bg-accent-soft text-accent-soft-ink hover:bg-accent-tint-press",
      )}
    >
      {index}
    </button>
  );
}

const REHYPE_PLUGINS: PluggableList = [
  [rehypeKatex, { throwOnError: false, errorColor: "inherit", strict: "ignore" }],
  [rehypeHighlight, { detect: false, ignoreMissing: true }],
];

function MarkdownRendererImpl({ text, maxCitation, activeCitation, onCite, fenceRenderers }: MarkdownRendererProps) {
  const remarkPlugins = useMemo(
    () => [remarkGfm, remarkMath, remarkCitations(maxCitation)],
    [maxCitation],
  );

  const components = useMemo<Components>(
    () => ({
      // 只有角标插件会产出 button（原始 HTML 未启用），所以 button 一律是引用角标
      button: (props) => {
        const raw = (props as Record<string, unknown>)["data-cite"];
        const index = Number(raw);
        if (!Number.isSafeInteger(index)) return <span>{props.children}</span>;
        const pos = (props as Record<string, unknown>)["data-pos"];
        const markerStart = pos === undefined ? null : Number(pos);
        return <CitationBadge index={index} markerStart={Number.isSafeInteger(markerStart) ? markerStart : null} />;
      },
      a: ({ node, ...props }: ComponentPropsWithoutRef<"a"> & ExtraProps) => {
        void node; // react-markdown 会传入 hast 节点，不能落到 DOM 上
        return <a {...props} target="_blank" rel="noopener noreferrer" />;
      },
      table: ({ node, ...props }: ComponentPropsWithoutRef<"table"> & ExtraProps) => {
        void node;
        return (
          <div className="table-wrap">
            <table {...props} />
          </div>
        );
      },
      pre: ({ node, children, ...props }: ComponentPropsWithoutRef<"pre"> & ExtraProps) => {
        const code = (node?.children?.[0] ?? undefined) as HastNode | undefined;
        const language = code?.properties?.className?.find((c) => c.startsWith("language-"))?.slice(9) ?? "";
        const renderer = language ? fenceRenderers?.[language] : undefined;
        if (renderer) return <>{renderer({ code: hastText(code), language })}</>;
        return <pre {...(props as object)}>{children}</pre>;
      },
    }),
    [fenceRenderers],
  );

  const citationContext = useMemo(() => ({ active: activeCitation, onCite }), [activeCitation, onCite]);

  return (
    <CitationContext.Provider value={citationContext}>
      <div className="report">
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={REHYPE_PLUGINS}
          components={components}
        >
          {text}
        </ReactMarkdown>
      </div>
    </CitationContext.Provider>
  );
}

const MarkdownRenderer = memo(MarkdownRendererImpl);
export default MarkdownRenderer;
