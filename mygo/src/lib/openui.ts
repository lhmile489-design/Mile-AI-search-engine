
// OpenUI 组件库定义：按 docs/OpenUI组件签名-草案.md 的签名注册组件。
// 围栏块由 OpenUiCard 直接解析并把解包后的 props 交给卡片组件渲染，
// 不走 OpenUI 自己的 Renderer —— 那样卡片里的 [n] 角标点击回调传不进去。

import { createLibrary, defineComponent } from "@openuidev/react-lang";
import { z } from "zod";

const Column = defineComponent({
  name: "Column",
  description: "表格列定义。key 对应 Row 的 cells 键；sortable 为 true 时该列可点击排序",
  props: z.object({
    key: z.string().describe("列键，只用小写字母、数字、下划线"),
    label: z.string().describe("列标题，展示给用户"),
    sortable: z.boolean().optional().describe("是否可排序，默认 false"),
    highlight: z.boolean().optional().describe("是否为重点列，默认 false；一张卡片最多一列"),
  }),
  component: () => null, // 只作参数，不直接渲染
});

const Row = defineComponent({
  name: "Row",
  description: "一行数据。cells 的键必须是已定义的列键；值一律写字符串，可带 [n] 引用角标",
  props: z.object({
    cells: z.record(z.string(), z.string()).describe("列键到单元格文字的映射"),
  }),
  component: () => null,
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
  component: () => null,
});

const Stage = defineComponent({
  name: "Stage",
  description: "流水线的一个阶段",
  props: z.object({
    name: z.string().describe("阶段名，如 TMA 异步加载"),
    duration: z.number().describe("该阶段耗时，单位由所在卡片的 unit 决定，必须大于等于 0"),
    detail: z.string().describe("展开后显示的时延说明，可带 [n] 引用角标"),
  }),
  component: () => null,
});

const PipelineClockCard = defineComponent({
  name: "PipelineClockCard",
  description: "执行流水线的分阶段耗时，用户点击阶段展开时延详情",
  props: z.object({
    title: z.string().describe("卡片标题，可带 [n] 引用角标"),
    unit: z.enum(["cycles", "ns", "us", "ms"]).describe("所有阶段共用的耗时单位"),
    stages: z.array(Stage.ref).describe("阶段，按执行顺序，2 到 8 个"),
  }),
  component: () => null,
});

// 后端 generator.py 的 System Prompt 让模型生成 `Table`（签名草案之外的名字），
// cells 用「列名」作键、Column 只有三个参数。注册同名组件兼容真实下发，
// 渲染复用同一个 BenchmarkCardView（note 缺省即不显示）。
const Table = defineComponent({
  name: "Table",
  description: "评测数据对比表（后端 prompt 里的卡片名）",
  props: z.object({
    title: z.string().describe("表格标题，可带 [n] 引用角标"),
    columns: z.array(Column.ref).describe("列定义"),
    rows: z.array(Row.ref).describe("数据行"),
  }),
  component: () => null,
});

/** 不设 root：几种卡片都能作为根组件解析（签名草案 D1 + 后端 Table）。 */
export const openUILibrary = createLibrary({
  components: [HardwareBenchmarkCard, Column, Row, PipelineClockCard, Stage, Table],
});

/** ElementNode：parser 产出的组件树节点。 */
export type OpenUiElement = Readonly<{
  type: "element";
  typeName: string;
  statementId?: string;
  partial: boolean;
  props: Record<string, unknown>;
}>;

/**
 * 递归解包 ElementNode -> 纯 props 对象：
 * - {type:"element"} -> { _typeName, ...解包后的 props }
 * - 数组逐元素解包；普通对象逐字段解包；原样返回标量。
 * 卡片组件拿到的是解包后的 props（columns/rows/stages 都是普通对象，不再是 element 节点）。
 */
export function unwrapOpenUi(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(unwrapOpenUi);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj.type === "element") {
      const el = value as unknown as OpenUiElement;
      const out: Record<string, unknown> = { _typeName: el.typeName };
      for (const [k, v] of Object.entries(el.props)) out[k] = unwrapOpenUi(v);
      return out;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = unwrapOpenUi(v);
    return out;
  }
  return value;
}
