import type { SseEvent } from "@/types";
import { buildDone, MOCK_RANKED, MOCK_RAW, trace } from "./fixtures";

// 一个场景 = 带延迟的事件脚本。delay 单位毫秒；事件 `null` 表示「此后不再发送任何数据」。

export type MockStep = Readonly<{ delay: number; event: SseEvent | null }>;
export type MockScenario = "error" | "silence" | "hallucination";

const head = (): ReadonlyArray<MockStep> => [
  { delay: 100, event: { type: "trace", data: trace("rewriting", "start", 5, null) } },
  {
    delay: 300,
    event: {
      type: "trace",
      data: trace("rewriting", "end", 400, 395, { queries: ["mock query one", "mock query two"], fallback: false, fallbackCode: null }),
    },
  },
  { delay: 50, event: { type: "trace", data: trace("searching", "start", 410, null, { engine: "tavily", queryCount: 2 }) } },
  { delay: 300, event: { type: "sources", data: { phase: "raw", engine: "tavily", queryIndex: 0, items: MOCK_RAW.slice(0, 2) } } },
  { delay: 300, event: { type: "sources", data: { phase: "raw", engine: "tavily", queryIndex: 1, items: MOCK_RAW.slice(1) } } },
  {
    delay: 100,
    event: {
      type: "trace",
      data: trace("searching", "end", 1000, 590, { enginesUsed: ["tavily"], rawCount: 4, failedQueries: [] }),
    },
  },
  { delay: 50, event: { type: "trace", data: trace("reasoning", "start", 1010, null) } },
  { delay: 100, event: { type: "sources", data: { phase: "ranked", engine: "tavily", queryIndex: null, items: MOCK_RANKED } } },
  {
    delay: 50,
    event: {
      type: "trace",
      data: trace("reasoning", "end", 1100, 90, { inputCount: 4, dedupedCount: 3, filteredCount: 3, rankedCount: 3, k: 10 }),
    },
  },
  { delay: 50, event: { type: "trace", data: trace("generating", "start", 1110, null, { model: "mock-model", sourceCount: 3 }) } },
];

// hallucination 场景的完整正文。done 里的 citations 偏移按它计算（与后端一样针对原始 report）。
// 正文里有两个指向信源 1 的 [1]，分别对应信源 1 里的两句，用来验证角标与高亮一一对应。
const HALLUCINATION_PARTS: ReadonlyArray<string> = [
  "## 结论\n\nFP8 内核在 Hopper 上的吞吐取决于调度方式 [1]，",
  "这条引用不存在 [99]，这条引用是半截 [3",
  "]。\n\n另一处结论同样来自第一个信源 [1]。",
  "\n\n**未闭合的加粗和代码围栏：\n\n```openui-lang\nroot = Card(",
];

const token = (delta: string, delay = 120): MockStep => ({ delay, event: { type: "token", data: { delta } } });

export function scenarioSteps(name: MockScenario): ReadonlyArray<MockStep> {
  switch (name) {
    case "error":
      // 生成中途 error：已生成内容必须保留
      return [
        ...head(),
        token("## 结论\n\nFP8 内核在 Hopper 上的吞吐取决于调度方式 [1]。"),
        token("\n\nTMA 拷贝降低寄存器压力 [2]，"),
        {
          delay: 400,
          event: {
            type: "error",
            data: { code: 50202, message: "生成研报中断：模型服务连接被重置", step: "generating", retryable: true, upstream: "llm" },
          },
        },
      ];
    case "silence":
      // 只发一个事件，然后既没有业务事件也没有心跳：触发 45 秒空闲看门狗
      return [{ delay: 100, event: { type: "trace", data: trace("rewriting", "start", 5, null) } }, { delay: 0, event: null }];
    case "hallucination":
      // 带 [99] 幻觉角标和未闭合代码围栏的正文，之后正常 done
      return [
        ...head(),
        ...HALLUCINATION_PARTS.map((part) => token(part)),
        { delay: 100, event: { type: "trace", data: trace("generating", "end", 2000, 890, { firstTokenMs: 300, charCount: 120 }) } },
        { delay: 50, event: { type: "done", data: buildDone(HALLUCINATION_PARTS.join("")) } },
      ];
  }
}
