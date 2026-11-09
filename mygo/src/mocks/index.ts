import type { OpenStream, SearchTransport } from "@/lib/transport";
import type { AppConfig, HistoryDetail, SuggestionsData } from "@/types";
import { scenarioSteps, type MockScenario } from "./scenarios";

// 开发期 mock：一处接管前端所有后端访问（SearchTransport），不走 Channel / Go。
//   - openStream：把 SseEvent 序列按延迟重放进 handlers
//   - getConfig / getSuggestions / 历史：返回固定的开发场景数据
// 启用：VITE_USE_MOCK=1 且 DEV；流场景用 URL 参数 ?mock=error|silence|hallucination。
// 45 秒看门狗不在 mock 里重放（silence 场景用 null 事件表达「此后无数据」）。

const SCENARIOS: ReadonlyArray<MockScenario> = ["error", "silence", "hallucination"];

function pickScenario(): MockScenario {
  const value = new URLSearchParams(window.location.search).get("mock");
  return SCENARIOS.find((name) => name === value) ?? "error";
}

// mock 的 config：必须含一个可用引擎，否则 submit 永远进不了 mock 流
//（state.engine 为 null 时会先 reloadConfig 找第一个 available 引擎）。
const MOCK_CONFIG: AppConfig = {
  focusModes: [
    { value: "academic", label: "学术" },
    { value: "code", label: "代码" },
    { value: "web", label: "网页" },
  ],
  engines: [{ value: "tavily", label: "Tavily", available: true }],
  scopes: [
    { value: "preprint", label: "预印本" },
    { value: "code", label: "代码" },
    { value: "spec", label: "规范" },
    { value: "docs", label: "文档" },
    { value: "blog", label: "博客" },
  ],
  version: "mock",
};

const MOCK_SUGGESTIONS: SuggestionsData = {
  items: [
    "FlashAttention-3 FP8 内核吞吐基准",
    "NVIDIA Hopper TMA 异步拷贝指令优化",
    "vLLM PagedAttention 原理与实现细节",
  ],
};

function createMockStream(scenario: MockScenario): OpenStream {
  return (_request, handlers) => {
    let dead = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    void (async () => {
      for (const step of scenarioSteps(scenario)) {
        if (dead) return;
        if (step.delay > 0) {
          await new Promise((resolve) => {
            const t = setTimeout(resolve, step.delay);
            timers.push(t);
          });
        }
        if (dead) return;
        if (step.event === null) return; // 保持打开，不再发送任何数据（模拟静默）
        handlers.onEvent(step.event);
        if (step.event.type === "done" || step.event.type === "error") return;
      }
      if (!dead) handlers.onClose();
    })();

    return {
      abort: () => {
        dead = true;
        timers.forEach(clearTimeout);
      },
    };
  };
}

// 历史：mock 返回空列表；getHistory 拒绝（mock 不持久化，详情没有可恢复的）。
const NOT_FOUND = Object.assign(new Error("历史记录在 mock 中不存在"), { name: "CallError" });

export function createMockTransport(): SearchTransport {
  const openStream = createMockStream(pickScenario());
  return {
    openStream,
    getConfig: async () => MOCK_CONFIG,
    getSuggestions: async () => MOCK_SUGGESTIONS,
    listHistory: async () => ({ total: 0, records: [] }),
    getHistory: async (_id: string): Promise<HistoryDetail> => {
      throw NOT_FOUND;
    },
    deleteHistory: async () => ({ deleted: false }),
    saveSettings: async () => {},
  };
}
