import type { Parent, PhrasingContent, Root, RootContent, Text } from "mdast";

// 引用角标：正文里的 [n] -> 可聚焦按钮（F05）。
// 增量边界可能切在 "[1" 与 "]" 之间，所以每次都对累计文本整体解析，不在 token 层做替换。

export const CITATION_PATTERN = /\[(\d+)\]/g;

export type TextPart =
  | Readonly<{ kind: "text"; text: string }>
  /** at：该标记在本段文本里的 UTF-16 下标 */
  | Readonly<{ kind: "cite"; index: number; raw: string; at: number }>;

/** 切分文本。n 超出 [1, max] 的标记按纯文本保留（幻觉引用不渲染成角标）。 */
export function splitCitations(text: string, max: number): ReadonlyArray<TextPart> {
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(CITATION_PATTERN)) {
    const index = Number(match[1]);
    if (!Number.isSafeInteger(index) || index < 1 || index > max) continue;
    const at = match.index ?? 0;
    if (at > cursor) parts.push({ kind: "text", text: text.slice(cursor, at) });
    parts.push({ kind: "cite", index, raw: match[0], at });
    cursor = at + match[0].length;
  }
  if (cursor < text.length) parts.push({ kind: "text", text: text.slice(cursor) });
  return parts;
}

/**
 * 求每个角标在「后端下发的原始 report」里的 UTF-16 偏移，对不上的返回 null。
 *
 * 不在渲染后的文本上算：mdast 的 text.value 已经过转义、实体解码，下标和原文对不上。
 * 做法：用 text 节点的 position.offset 取出它在原文里的那一段，在这段原文上重新匹配 [n]，
 * 再把 value 里的每个角标按顺序配对到原文里的匹配。配对要求编号一致，并且标记前后各两个字符一致
 * （转义的 \[1\] 在 value 里是 "[1]"，原文里并不是角标，前后文对不上就不会误配）。
 * 配不上的返回 null，调用方只定位卡片、不高亮句子，宁可少高亮也不给错偏移。
 */
export function markerOffsets(
  value: string,
  max: number,
  source: string,
  nodeStart: number | undefined,
  nodeEnd: number | undefined,
): ReadonlyArray<number | null> {
  const inValue = splitCitations(value, max).filter((part) => part.kind === "cite");
  if (nodeStart === undefined || nodeEnd === undefined) return inValue.map(() => null);
  const slice = source.slice(nodeStart, nodeEnd);
  const inSource = splitCitations(slice, max).filter((part) => part.kind === "cite");
  const around = (text: string, at: number, len: number) => `${text.slice(Math.max(0, at - 2), at)}|${text.slice(at + len, at + len + 2)}`;

  let from = 0;
  return inValue.map((cite) => {
    if (cite.kind !== "cite") return null;
    for (let k = from; k < inSource.length; k += 1) {
      const candidate = inSource[k];
      if (candidate.kind !== "cite" || candidate.index !== cite.index) continue;
      if (around(slice, candidate.at, candidate.raw.length) !== around(value, cite.at, cite.raw.length)) continue;
      from = k + 1;
      return nodeStart + candidate.at;
    }
    return null;
  });
}

/** 角标节点：渲染成 <button data-cite="n" data-pos="偏移">，由 MarkdownRenderer 的 button 组件接管。 */
function citeNode(index: number, raw: string, pos: number | null): PhrasingContent {
  const hProperties: Record<string, string> = { "data-cite": String(index) };
  if (pos !== null) hProperties["data-pos"] = String(pos);
  return { type: "text", value: raw, data: { hName: "button", hProperties } } as unknown as PhrasingContent;
}

function transform(parent: Parent, max: number, insideLink: boolean, source: string): void {
  const next: RootContent[] = [];
  for (const child of parent.children as RootContent[]) {
    if (child.type === "text" && !insideLink) {
      const text = child as Text;
      const parts = splitCitations(text.value, max);
      if (!parts.some((part) => part.kind === "cite")) {
        next.push(child);
        continue;
      }
      const offsets = markerOffsets(text.value, max, source, text.position?.start.offset, text.position?.end.offset);
      let cursor = 0;
      for (const part of parts) {
        if (part.kind === "cite") {
          next.push(citeNode(part.index, part.raw, offsets[cursor] ?? null) as RootContent);
          cursor += 1;
        } else {
          next.push({ type: "text", value: part.text } as RootContent);
        }
      }
      continue;
    }
    if ("children" in child) {
      const nowInsideLink = insideLink || child.type === "link" || child.type === "linkReference";
      transform(child as Parent, max, nowInsideLink, source);
    }
    next.push(child);
  }
  parent.children = next as Parent["children"];
}

/**
 * remark 插件工厂：code / inlineCode / math 不是 text 节点，天然不会被替换。
 * 原文从 vfile 取（react-markdown 把传入的字符串放在 file.value 里），即后端下发的原始 report。
 */
export function remarkCitations(max: number) {
  return () => (tree: Root, file: { value: unknown }) => {
    if (max > 0) transform(tree, max, false, String(file.value ?? ""));
  };
}
