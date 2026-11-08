import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Root } from "mdast";
import MarkdownRenderer from "@/components/search/MarkdownRenderer";
import type { Citation } from "@/types";
import { remarkCitations, splitCitations } from "../citations";
import { collectRanges, splitPassage } from "../highlight";

describe("splitCitations（[n] 角标识别）", () => {
  it("范围内的 [n] 识别为角标，其余文本原样保留", () => {
    expect(splitCitations("甲 [1] 乙 [2]。", 3)).toEqual([
      { kind: "text", text: "甲 " },
      { kind: "cite", index: 1, raw: "[1]" },
      { kind: "text", text: " 乙 " },
      { kind: "cite", index: 2, raw: "[2]" },
      { kind: "text", text: "。" },
    ]);
  });

  it("n 超出信源范围（[99]、[0]）按纯文本显示", () => {
    const parts = splitCitations("结论 [99] 与 [0] 与 [3]", 3);
    expect(parts.filter((p) => p.kind === "cite")).toEqual([{ kind: "cite", index: 3, raw: "[3]" }]);
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
    remarkCitations(2)()(root);
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
});

describe("highlight：UTF-16 偏移与 slice", () => {
  const citation = (index: number, start: number, end: number): Citation => ({
    index,
    markerStart: 0,
    markerEnd: 0,
    sentenceStart: 0,
    sentenceEnd: 0,
    highlight: { start, end, score: 0.5 },
  });

  it("中文：偏移按码元，直接 slice", () => {
    const passage = "第一句。目标句子在这里。第三句。";
    const start = passage.indexOf("目标");
    const end = passage.indexOf("。", start) + 1;
    const segments = splitPassage(passage, collectRanges([citation(1, start, end)], 1, passage.length));
    expect(segments.map((s) => s.text)).toEqual(["第一句。", "目标句子在这里。", "第三句。"]);
    expect(segments.map((s) => s.marked)).toEqual([false, true, false]);
  });

  it("emoji（代理对，占 2 个码元）之后的偏移仍然对齐", () => {
    const smile = "\u{1F600}"; // 码点 1 个，UTF-16 码元 2 个
    const passage = `前${smile}${smile}句。目标${smile}句。后`;
    expect(Array.from(passage).length).not.toBe(passage.length);
    // 后端按 UTF-16 码元给偏移：这里用 JS 的 indexOf 得到的正是码元偏移
    const start = passage.indexOf("目标");
    const end = passage.indexOf("句。", start) + 2;
    const segments = splitPassage(passage, collectRanges([citation(1, start, end)], 1, passage.length));
    expect(segments[1]).toEqual({ text: `目标${smile}句。`, marked: true });
    expect(segments[0].text).toBe(`前${smile}${smile}句。`);
    expect(segments[2].text).toBe("后");
  });

  it("highlight 为 null、编号不匹配、越界区间都安全", () => {
    const passage = "abcdef";
    const none: Citation = { ...citation(1, 0, 0), highlight: null };
    expect(splitPassage(passage, collectRanges([none], 1, passage.length))).toEqual([{ text: passage, marked: false }]);
    expect(collectRanges([citation(2, 0, 3)], 1, passage.length)).toEqual([]);
    expect(collectRanges([citation(1, 4, 99)], 1, passage.length)).toEqual([{ start: 4, end: 6 }]);
    expect(collectRanges([citation(1, 3, 3)], 1, passage.length)).toEqual([]);
  });

  it("同一信源多条引用：区间排序并合并重叠", () => {
    const ranges = collectRanges([citation(1, 10, 20), citation(1, 0, 5), citation(1, 4, 8)], 1, 100);
    expect(ranges).toEqual([{ start: 0, end: 8 }, { start: 10, end: 20 }]);
  });
});
