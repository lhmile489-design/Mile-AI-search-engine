import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { VFile } from "vfile";
import MarkdownRenderer from "@/components/search/MarkdownRenderer";
import type { Citation } from "@/types";
import { markerOffsets, remarkCitations, splitCitations } from "../citations";
import { rangeForMarker, splitPassage } from "../highlight";

describe("splitCitations（[n] 角标识别）", () => {
  it("范围内的 [n] 识别为角标，其余文本原样保留", () => {
    expect(splitCitations("甲 [1] 乙 [2]。", 3)).toEqual([
      { kind: "text", text: "甲 " },
      { kind: "cite", index: 1, raw: "[1]", at: 2 },
      { kind: "text", text: " 乙 " },
      { kind: "cite", index: 2, raw: "[2]", at: 8 },
      { kind: "text", text: "。" },
    ]);
  });

  it("n 超出信源范围（[99]、[0]）按纯文本显示", () => {
    const parts = splitCitations("结论 [99] 与 [0] 与 [3]", 3);
    expect(parts.filter((p) => p.kind === "cite")).toEqual([{ kind: "cite", index: 3, raw: "[3]", at: 16 }]);
    expect(parts.map((p) => (p.kind === "text" ? p.text : p.raw)).join("")).toBe("结论 [99] 与 [0] 与 [3]");
  });

  it("没有信源时全部按纯文本", () => {
    expect(splitCitations("[1][2]", 0)).toEqual([{ kind: "text", text: "[1][2]" }]);
  });

  it("流式半截标记 [1 不会被识别，补全后整体解析才识别", () => {
    expect(splitCitations("结论 [1", 2).some((p) => p.kind === "cite")).toBe(false);
    expect(splitCitations("结论 [1]", 2).some((p) => p.kind === "cite")).toBe(true);
  });

  it("连续角标 [1][2] 各自识别", () => {
    expect(splitCitations("x[1][2]", 2).filter((p) => p.kind === "cite")).toHaveLength(2);
  });
});

describe("remarkCitations（mdast 变换）", () => {
  const tree = (): Root => ({
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [
          { type: "text", value: "见 [1] 与 [99]" },
          { type: "inlineCode", value: "arr[1]" },
          { type: "link", url: "https://e.com", children: [{ type: "text", value: "链接 [1]" }] },
        ],
      },
      { type: "code", lang: "ts", value: "const a = b[1]" },
    ],
  });

  it("只替换正文 text 里的合法角标；行内代码、代码块、链接内文本不动", () => {
    const root = tree();
    remarkCitations(2)()(root, { value: "" });
    const paragraph = root.children[0] as { children: Array<{ type: string; value?: string; data?: unknown }> };
    const cites = paragraph.children.filter((n) => n.data && (n.data as { hName?: string }).hName === "button");
    expect(cites).toHaveLength(1);
    expect(paragraph.children.some((n) => n.type === "inlineCode" && n.value === "arr[1]")).toBe(true);
    expect(JSON.stringify(root)).toContain("链接 [1]");
    expect((root.children[1] as { value: string }).value).toBe("const a = b[1]");
  });
});

describe("MarkdownRenderer 整体渲染", () => {
  const render = (text: string, max: number) =>
    renderToStaticMarkup(<MarkdownRenderer text={text} maxCitation={max} activeCitation={null} onCite={() => {}} />);

  it("[n] 渲染为可聚焦按钮，超范围的 [99] 按纯文本", () => {
    const html = render("结论成立 [1]，但这条不存在 [99]。", 2);
    expect(html).toContain('<button type="button" aria-label="查看第 1 个信源"');
    expect(html).toContain("[99]");
    expect(html).not.toContain("查看第 99 个信源");
  });

  it("未闭合的粗体与代码围栏不会抛错", () => {
    expect(() => render("**未闭合\n\n```openui-lang\nroot = Card(", 1)).not.toThrow();
  });

  it("openui-lang 围栏块本轮按普通代码块显示", () => {
    const html = render("```openui-lang\nroot = Card(title)\n```", 1);
    expect(html).toContain("<pre>");
    expect(html).toContain("root = Card(title)");
  });

  it("只有编号与偏移都一致的那一个角标处于激活状态", () => {
    const text = "甲 [1] 乙 [1]。";
    const second = text.lastIndexOf("[1]");
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        text={text}
        maxCitation={2}
        activeCitation={{ index: 1, markerStart: second }}
        onCite={() => {}}
      />,
    );
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(1);
  });

  it("F06：markerStart 为 null 时，编号匹配的角标全部高亮，其他编号不高亮", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        text="甲 [1] 乙 [2] 丙 [1]。"
        maxCitation={2}
        activeCitation={{ index: 1, markerStart: null }}
        onCite={() => {}}
      />,
    );
    const pressed = (n: number, v: string) =>
      (html.match(new RegExp(`aria-label="查看第 ${n} 个信源"[^>]*aria-pressed="${v}"`, "g")) ?? []).length;
    expect(pressed(1, "true")).toBe(2);
    expect(pressed(2, "false")).toBe(1);
    expect(pressed(2, "true")).toBe(0);
  });
});

describe("highlight：UTF-16 偏移与 slice", () => {
  const citation = (index: number, markerStart: number, start: number, end: number): Citation => ({
    index,
    markerStart,
    markerEnd: markerStart + 3,
    sentenceStart: 0,
    sentenceEnd: 0,
    highlight: { start, end, score: 0.5 },
  });

  it("中文：偏移按码元，直接 slice", () => {
    const passage = "第一句。目标句子在这里。第三句。";
    const start = passage.indexOf("目标");
    const end = passage.indexOf("。", start) + 1;
    const segments = splitPassage(passage, rangeForMarker([citation(1, 10, start, end)], 1, 10, passage.length));
    expect(segments.map((s) => s.text)).toEqual(["第一句。", "目标句子在这里。", "第三句。"]);
    expect(segments.map((s) => s.marked)).toEqual([false, true, false]);
  });

  it("emoji（代理对，占 2 个码元）之后的偏移仍然对齐", () => {
    const smile = "\u{1F600}"; // 码点 1 个，UTF-16 码元 2 个
    const passage = `前${smile}${smile}句。目标${smile}句。后`;
    expect(Array.from(passage).length).not.toBe(passage.length);
    const start = passage.indexOf("目标");
    const end = passage.indexOf("句。", start) + 2;
    const segments = splitPassage(passage, rangeForMarker([citation(1, 0, start, end)], 1, 0, passage.length));
    expect(segments[1]).toEqual({ text: `目标${smile}句。`, marked: true });
    expect(segments[0].text).toBe(`前${smile}${smile}句。`);
    expect(segments[2].text).toBe("后");
  });

  it("同一信源的两个角标（markerStart 不同）分别得到各自的高亮，互不干扰", () => {
    const list = [citation(1, 10, 0, 5), citation(1, 40, 20, 30)];
    expect(rangeForMarker(list, 1, 10, 100)).toEqual([{ start: 0, end: 5 }]);
    expect(rangeForMarker(list, 1, 40, 100)).toEqual([{ start: 20, end: 30 }]);
  });

  it("降级：偏移未知、没有对应条目、highlight 为 null、越界、空区间", () => {
    const list = [citation(1, 10, 0, 5)];
    expect(rangeForMarker(list, 1, null, 100)).toEqual([]);
    expect(rangeForMarker(list, 1, 11, 100)).toEqual([]);
    expect(rangeForMarker(list, 2, 10, 100)).toEqual([]);
    expect(rangeForMarker([{ ...list[0], highlight: null }], 1, 10, 100)).toEqual([]);
    expect(rangeForMarker([citation(1, 10, 4, 99)], 1, 10, 6)).toEqual([{ start: 4, end: 6 }]);
    expect(rangeForMarker([citation(1, 10, 3, 3)], 1, 10, 6)).toEqual([]);
  });
});

// ---- 角标偏移：必须是后端下发的原始 report 里的 UTF-16 偏移 ----

function parseWithCitations(source: string, max: number) {
  const file = new VFile(source);
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkCitations(max));
  const tree = processor.parse(file);
  processor.runSync(tree, file);
  const found: Array<{ index: number; pos: string | undefined }> = [];
  const walk = (node: unknown) => {
    const n = node as { data?: { hName?: string; hProperties?: Record<string, string> }; children?: unknown[] };
    if (n.data?.hName === "button") {
      found.push({ index: Number(n.data.hProperties?.["data-cite"]), pos: n.data.hProperties?.["data-pos"] });
    }
    n.children?.forEach(walk);
  };
  walk(tree);
  return found;
}

describe("remarkCitations：角标偏移对应原始 report", () => {
  it("每个角标的偏移等于它在原文里的 UTF-16 下标", () => {
    const source = "甲 [1]，乙 [2]。\n\n丙 [1][3]。";
    const found = parseWithCitations(source, 3);
    const expected = [...source.matchAll(/\[(\d+)\]/g)].map((m) => String(m.index));
    expect(found.map((f) => f.pos)).toEqual(expected);
    expect(found.map((f) => f.index)).toEqual([1, 2, 1, 3]);
  });

  it("emoji 与中文前缀：偏移仍按码元，和 JS indexOf 一致", () => {
    const smile = "\u{1F600}";
    const source = `# 标题${smile}\n\n前缀${smile}${smile}文字 [2] 后面 [1]。`;
    const found = parseWithCitations(source, 2);
    expect(found.map((f) => f.pos)).toEqual([String(source.indexOf("[2]")), String(source.indexOf("[1]"))]);
  });

  it("幻觉角标 [99] 不产生角标，也不影响其他角标的偏移", () => {
    const source = "甲 [99] 乙 [1]。";
    const found = parseWithCitations(source, 2);
    expect(found).toEqual([{ index: 1, pos: String(source.indexOf("[1]")) }]);
  });

  it("代码块、行内代码、链接内的 [n] 不识别", () => {
    const source = "正文 [1]\n\n```\nb[1]\n```\n\n`c[1]` 与 [链接 [1]](https://e.com)";
    const found = parseWithCitations(source, 2);
    expect(found).toHaveLength(1);
    expect(found[0].pos).toBe(String(source.indexOf("[1]")));
  });

  it("转义的 \\[1\\] 在原文里不是角标：它没有偏移，且不会让后面的角标偏移错位", () => {
    const source = "转义 \\[1\\] 之后 [2]。";
    const found = parseWithCitations(source, 2);
    expect(found).toHaveLength(2);
    expect(found[0]).toEqual({ index: 1, pos: undefined });
    expect(found[1]).toEqual({ index: 2, pos: String(source.indexOf("[2]")) });
  });

  it("转义的 \\[1\\] 之后还有真正的 [1]：真正的那个拿到自己的偏移，转义的不抢", () => {
    const source = "甲 \\[1\\] 乙 [1]。";
    const found = parseWithCitations(source, 1);
    expect(found[0].pos).toBeUndefined();
    expect(found[1].pos).toBe(String(source.lastIndexOf("[1]")));
  });

  it("markerOffsets：原文与渲染文本的角标个数对不上时放弃（返回 null），不给错偏移", () => {
    expect(markerOffsets("看 [1]", 2, "看 \\[1\\]", 0, 8)).toEqual([null]);
    expect(markerOffsets("看 [1]", 2, "看 [1]", undefined, undefined)).toEqual([null]);
    expect(markerOffsets("看 [1]", 2, "xx看 [1]", 2, 7)).toEqual([4]);
  });

  it("与后端 citations 对得上：用角标偏移能找到各自的 citation 与高亮", () => {
    const source = "第一句 [1]。第二句 [1]。";
    const found = parseWithCitations(source, 1);
    const citations: Citation[] = [...source.matchAll(/\[1\]/g)].map((m, i) => ({
      index: 1,
      markerStart: m.index ?? 0,
      markerEnd: (m.index ?? 0) + 3,
      sentenceStart: 0,
      sentenceEnd: 0,
      highlight: { start: i * 10, end: i * 10 + 5, score: 0.5 },
    }));
    const first = rangeForMarker(citations, 1, Number(found[0].pos), 100);
    const second = rangeForMarker(citations, 1, Number(found[1].pos), 100);
    expect(first).toEqual([{ start: 0, end: 5 }]);
    expect(second).toEqual([{ start: 10, end: 15 }]);
  });
});
