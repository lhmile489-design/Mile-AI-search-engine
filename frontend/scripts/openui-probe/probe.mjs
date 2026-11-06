// M1 探针：验证 OpenUI 组件签名草案能被 @openuidev/react-lang 正确解析，并导出给模型的提示词。
// 依赖不进 frontend/package.json，装在项目外的临时目录，用环境变量指过去：
//
//   OPENUI_TELEMETRY_DISABLED=1 npm install --prefix "$TEMP/openui-m1" --ignore-scripts \
//     @openuidev/react-lang@1.1.0 zod@4 react@19.1.0 react-dom@19.1.0
//   OPENUI_PROBE_DIR="$TEMP/openui-m1" node scripts/openui-probe/probe.mjs [section]
//
// section 可选：parse（默认）、stream、edge、fence、prompt、all
import path from "node:path";
import { pathToFileURL } from "node:url";

const probeDir = process.env.OPENUI_PROBE_DIR;
if (!probeDir) {
  console.error("请设置 OPENUI_PROBE_DIR 指向临时安装目录");
  process.exit(2);
}
const load = (pkg, entry) =>
  import(pathToFileURL(path.join(probeDir, "node_modules", pkg, entry)).href);

const { z } = await load("zod", "index.js");
const lang = await load("@openuidev/react-lang", "dist/index.mjs");
const { createLibrary, defineComponent, createParser, createStreamingParser } = lang;
const { SAMPLES } = await import("./samples.mjs");

// ---------- 组件签名（与 docs/OpenUI组件签名-草案.md 保持一致） ----------
// 位置参数顺序 = z.object 里的键顺序。渲染函数在探针里不需要，返回 null。
const none = () => null;

const Column = defineComponent({
  name: "Column",
  description: "表格列定义。key 对应 Row 的 cells 键；sortable 为 true 时该列可点击排序（按单元格开头的数字排序）",
  props: z.object({
    key: z.string().describe("列键，只用小写字母、数字、下划线"),
    label: z.string().describe("列标题，展示给用户"),
    sortable: z.boolean().optional().describe("是否可排序，默认 false"),
    highlight: z.boolean().optional().describe("是否为重点列，默认 false；一张卡片最多一列"),
  }),
  component: none,
});

const Row = defineComponent({
  name: "Row",
  description: "一行数据。cells 的键必须是已定义的列键；值一律写字符串，可带 [n] 引用角标",
  props: z.object({
    cells: z.record(z.string(), z.string()).describe("列键到单元格文字的映射"),
  }),
  component: none,
});

const HardwareBenchmarkCard = defineComponent({
  name: "HardwareBenchmarkCard",
  description: "硬件或算法的评测数据对比表。只在信源里有可对比的数字时使用",
  props: z.object({
    title: z.string().describe("卡片标题，可带 [n] 引用角标"),
    columns: z.array(Column.ref).describe("列定义，2 到 6 列"),
    rows: z.array(Row.ref).describe("数据行，1 到 12 行"),
    note: z.string().optional().describe("表下注释，如测试条件，可带 [n]"),
  }),
  component: none,
});

const Stage = defineComponent({
  name: "Stage",
  description: "流水线的一个阶段",
  props: z.object({
    name: z.string().describe("阶段名，如 TMA 异步加载"),
    duration: z.number().describe("该阶段耗时，单位由所在卡片的 unit 决定，必须大于等于 0"),
    detail: z.string().describe("展开后显示的时延说明，可带 [n] 引用角标"),
  }),
  component: none,
});

const PipelineClockCard = defineComponent({
  name: "PipelineClockCard",
  description: "执行流水线的分阶段耗时，用户点击阶段展开时延详情",
  props: z.object({
    title: z.string().describe("卡片标题，可带 [n] 引用角标"),
    unit: z.enum(["cycles", "ns", "us", "ms"]).describe("所有阶段共用的耗时单位"),
    stages: z.array(Stage.ref).describe("阶段，按执行顺序，2 到 8 个"),
  }),
  component: none,
});

const components = [HardwareBenchmarkCard, Column, Row, PipelineClockCard, Stage];

// ---------- 工具函数 ----------
const brief = (node, depth = 0) => {
  if (Array.isArray(node)) return node.map((n) => brief(n, depth));
  if (!node || typeof node !== "object" || node.type !== "element") return node;
  const props = {};
  for (const [k, v] of Object.entries(node.props)) props[k] = depth > 3 ? "..." : brief(v, depth + 1);
  return { [node.typeName + (node.partial ? " (partial)" : "")]: props };
};
const report = (label, result) => {
  console.log(`\n== ${label}`);
  console.log("root:", JSON.stringify(brief(result.root)));
  const { incomplete, unresolved, orphaned, statementCount, errors } = result.meta;
  console.log("meta:", JSON.stringify({ incomplete, unresolved, orphaned, statementCount }));
  console.log("errors:", JSON.stringify(errors.map((e) => `${e.code} ${e.statementId ?? ""} ${e.path ?? ""} ${e.message}`)));
};

// ---------- 用例 ----------
const section = process.argv[2] ?? "parse";
const run = (name) => section === name || section === "all";

// 每种卡片单独建库，root 指向对应卡片（library.root 只能是一个组件名）
const benchLib = createLibrary({ components, root: "HardwareBenchmarkCard" });
const clockLib = createLibrary({ components, root: "PipelineClockCard" });
// 不指定 root：一个库同时接受两种卡片
const openLib = createLibrary({ components });

if (run("parse")) {
  report("benchmark 完整示例", createParser(benchLib.toJSONSchema(), benchLib.root).parse(SAMPLES.benchmark));
  report("clock 完整示例", createParser(clockLib.toJSONSchema(), clockLib.root).parse(SAMPLES.clock));
  const open = createParser(openLib.toJSONSchema());
  report("不指定 root 的库 + benchmark", open.parse(SAMPLES.benchmark));
  report("不指定 root 的库 + clock", open.parse(SAMPLES.clock));
}

if (run("stream")) {
  const src = SAMPLES.benchmark;
  const cut = src.indexOf('c3 = Column("tflops"') + 'c3 = Column("tfl'.length;
  const sp = createStreamingParser(benchLib.toJSONSchema(), benchLib.root);
  report(`流式：截断在第 ${src.slice(0, cut).split("\n").length} 行中间`, sp.set(src.slice(0, cut)));
  report("流式：补齐后 complete=true", sp.set(src, true));
  // 逐字符 push，统计 root 第一次出现时收到了多少字符
  const sp2 = createStreamingParser(benchLib.toJSONSchema(), benchLib.root);
  let firstRootAt = -1;
  let thrown = 0;
  for (let i = 0; i < src.length; i += 1) {
    try {
      const r = sp2.push(src[i]);
      if (firstRootAt < 0 && r.root) firstRootAt = i + 1;
    } catch {
      thrown += 1;
    }
  }
  console.log(`\n== 逐字符 push：共 ${src.length} 字符，root 首次出现在第 ${firstRootAt} 个字符，抛异常 ${thrown} 次`);
}

if (run("edge")) {
  const p = createParser(benchLib.toJSONSchema(), benchLib.root);
  for (const [label, src] of Object.entries(SAMPLES.edge)) report(`边界：${label}`, p.parse(src));
  const pc = createParser(clockLib.toJSONSchema(), clockLib.root);
  for (const [label, src] of Object.entries(SAMPLES.edgeClock)) report(`边界：${label}`, pc.parse(src));
}

if (run("fence")) {
  // 研报是 Markdown，卡片放在 ```openui-lang 代码块里。两张卡片都用 c1 / r1 命名时，
  // 整段一次解析会把所有块拼成一个程序，后面的同名语句覆盖前面的，第一张卡片静默丢失。
  const p = createParser(openLib.toJSONSchema());
  const one = 'root = HardwareBenchmarkCard("A [1]", [c1], [r1])\nc1 = Column("k", "K")\nr1 = Row({k: "1"})';
  const two = 'root = HardwareBenchmarkCard("B [2]", [c1], [r1])\nc1 = Column("k", "K2")\nr1 = Row({k: "2"})';
  const md = "## 结论\n正文 [1]。\n\n```openui-lang\n" + one + "\n```\n\n中间段落。\n\n```openui-lang\n" + two + "\n```\n";
  report("fence：整段 Markdown 一次解析（两张卡片）", p.parse(md));
  report("fence：只解析第 1 块", p.parse(one));
  report("fence：只解析第 2 块", p.parse(two));
}

if (run("prompt")) {
  const prompt = openLib.prompt({
    inlineMode: true,
    examples: [SAMPLES.benchmark, SAMPLES.clock],
  });
  console.log("\n== library.prompt({ inlineMode: true, examples }) 输出");
  console.log(`长度 ${prompt.length} 字符`);
  console.log("-----BEGIN PROMPT-----");
  console.log(prompt);
  console.log("-----END PROMPT-----");
}
