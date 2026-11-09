import type { OpenStream } from "@/lib/sse";
import { scenarioSteps, type MockScenario } from "./scenarios";

// 开发期 mock：只替换 fetch，真实的 SSE 解析、事件校验和 45 秒看门狗照常运行。
// 启用：NEXT_PUBLIC_USE_MOCK=1 且非生产构建；场景用 URL 参数选择：?mock=error|silence|hallucination。

const SCENARIOS: ReadonlyArray<MockScenario> = ["error", "silence", "hallucination"];

function pickScenario(): MockScenario {
  const value = new URLSearchParams(window.location.search).get("mock");
  return SCENARIOS.find((name) => name === value) ?? "error";
}

function mockFetch(scenario: MockScenario): typeof fetch {
  return async (_input, init) => {
    const encoder = new TextEncoder();
    const steps = scenarioSteps(scenario);
    const signal = init?.signal ?? undefined;
    let id = 0;
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const aborted = () => controller.error(new DOMException("Aborted", "AbortError"));
        signal?.addEventListener("abort", aborted, { once: true });
        for (const step of steps) {
          await new Promise((resolve) => setTimeout(resolve, step.delay));
          if (signal?.aborted) return;
          if (step.event === null) return; // 保持连接打开，不再发送任何数据
          id += 1;
          controller.enqueue(
            encoder.encode(`id: ${id}\nevent: ${step.event.type}\ndata: ${JSON.stringify(step.event.data)}\n\n`),
          );
        }
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } });
  };
}

export function createMockOpenStream(real: OpenStream): OpenStream {
  return (request, handlers, options) =>
    real(request, handlers, { ...options, fetchImpl: mockFetch(pickScenario()) });
}
