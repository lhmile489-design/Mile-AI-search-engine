import type { Parent, PhrasingContent, Root, RootContent, Text } from "mdast";

// 引用角标：正文里的 [n] -> 可聚焦按钮（F05）。
// 增量边界可能切在 "[1" 与 "]" 之间，所以每次都对累计文本整体解析，不在 token 层做替换。

export const CITATION_PATTERN = /\[(\d+)\]/g;

export type TextPart =
  | Readonly<{ kind: "text"; text: string }>
  | Readonly<{ kind: "cite"; index: number; raw: string }>;

/** 切分文本。n 超出 [1, max] 的标记按纯文本保留（幻觉引用不渲染成角标）。 */
export function splitCitations(text: string, max: number): ReadonlyArray<TextPart> {
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(CITATION_PATTERN)) {
    const index = Number(match[1]);
    if (!Number.isSafeInteger(index) || index < 1 || index > max) continue;
    const at = match.index ?? 0;
    if (at > cursor) parts.push({ kind: "text", text: text.slice(cursor, at) });
    parts.push({ kind: "cite", index, raw: match[0] });
    cursor = at + match[0].length;
  }
  if (cursor < text.length) parts.push({ kind: "text", text: text.slice(cursor) });
  return parts;
}

/** 角标节点：渲染成 <button data-cite="n">，由 MarkdownRenderer 的 button 组件接管。 */
function citeNode(index: number, raw: string): PhrasingContent {
  return {
    type: "text",
    value: raw,
    data: { hName: "button", hProperties: { "data-cite": String(index) } },
  } as unknown as PhrasingContent;
}

function transform(parent: Parent, max: number, insideLink: boolean): void {
  const next: RootContent[] = [];
  for (const child of parent.children as RootContent[]) {
    if (child.type === "text" && !insideLink) {
      const parts = splitCitations((child as Text).value, max);
      if (!parts.some((part) => part.kind === "cite")) {
        next.push(child);
        continue;
      }
      for (const part of parts) {
        next.push(
          (part.kind === "cite"
            ? citeNode(part.index, part.raw)
            : { type: "text", value: part.text }) as RootContent,
        );
      }
      continue;
    }
    if ("children" in child) {
      const nowInsideLink = insideLink || child.type === "link" || child.type === "linkReference";
      transform(child as Parent, max, nowInsideLink);
    }
    next.push(child);
  }
  parent.children = next as Parent["children"];
}

/** remark 插件工厂：code / inlineCode / math 不是 text 节点，天然不会被替换。 */
export function remarkCitations(max: number) {
  return () => (tree: Root) => {
    if (max > 0) transform(tree, max, false);
  };
}
