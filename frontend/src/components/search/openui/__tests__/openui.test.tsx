import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createParser } from "@openuidev/react-lang";
import { openUILibrary, unwrapOpenUi } from "@/lib/openui";
import { OpenUiCard } from "../OpenUiCard";

// F11 交互卡片：DSL 解析、解包、降级、流式占位的单元测试。
// 用 react-dom/server 的 renderToStaticMarkup —— 不挂载 DOM，只校验 HTML 结构。

const BENCH = `root = HardwareBenchmarkCard("FA3 vs FA2 吞吐 [1]", [c1, c2], [r1, r2], "H100 [2]")
c1 = Column("kernel", "内核")
c2 = Column("tflops", "吞吐", true, true)
r1 = Row({kernel: "FA2", tflops: "350"})
r2 = Row({kernel: "FA3 [1]", tflops: "740 [1]"})`;

const CLOCK = `root = PipelineClockCard("GEMM 流水线 [3]", "ns", [s1, s2])
s1 = Stage("TMA 加载", 120, "异步搬运 [3]")
s2 = Stage("Tensor Core", 340, "WGMMA [3]")`;

const card = (code: string, maxCitation = 9) =>
  renderToStaticMarkup(<OpenUiCard code={code} language="openui-lang" maxCitation={maxCitation} onCite={() => {}} />);

describe("OpenUI DSL 解析与解包", () => {
  const parser = createParser(openUILibrary.toJSONSchema());

  it("合法 benchmark DSL：root 为元素，无 errors", () => {
    const r = parser.parse(BENCH);
    expect(r.root).not.toBeNull();
    expect(r.meta.errors).toHaveLength(0);
  });

  it("合法 clock DSL：root 为元素，无 errors", () => {
    const r = parser.parse(CLOCK);
    expect(r.root).not.toBeNull();
    expect(r.meta.errors).toHaveLength(0);
  });

  it("嵌套 props 解包为纯对象（columns/rows 不是 element 节点）", () => {
    const r = parser.parse(BENCH);
    const props = unwrapOpenUi(r.root!.props) as {
      title: string;
      columns: Array<{ key: string; label: string; sortable?: boolean }>;
      rows: Array<{ cells: Record<string, string> }>;
    };
    expect(props.title).toContain("FA3");
    expect(props.columns).toHaveLength(2);
    expect(props.columns[1].sortable).toBe(true);
    expect(props.rows[0].cells.tflops).toBe("350");
  });

  it("缺必填字段：root null + errors 非空", () => {
    const r = parser.parse('root = HardwareBenchmarkCard("t")');
    expect(r.root).toBeNull();
    expect(r.meta.errors.length).toBeGreaterThan(0);
  });
});

describe("OpenUiCard 渲染", () => {
  it("合法卡片：渲染可排序表格 + 视图切换按钮", () => {
    const html = card(BENCH);
    expect(html).toContain("交互视图");
    expect(html).toContain("DSL 源码");
    expect(html).toContain("<table");
    expect(html).toContain("吞吐");
    expect(html).toContain("740");
  });

  it("卡片内 [n] 渲染为角标按钮", () => {
    const html = card(BENCH);
    expect(html).toContain('aria-label="查看第 1 个信源"');
  });

  it("clock 卡片：渲染阶段耗时 + 单位", () => {
    const html = card(CLOCK);
    expect(html).toContain("TMA 加载");
    expect(html).toContain("340");
    expect(html).toContain("ns");
  });

  it("解析失败：降级为 DSL 源码视图并说明原因", () => {
    const html = card("root = NonexistentCard()");
    expect(html).toContain("DSL 源码");
    expect(html).toContain("显示 DSL 源码");
  });

  it("非法 DSL：降级且不抛错", () => {
    expect(() => card("这不是 DSL")).not.toThrow();
    expect(card("这不是 DSL")).toContain("DSL 源码");
  });
});
