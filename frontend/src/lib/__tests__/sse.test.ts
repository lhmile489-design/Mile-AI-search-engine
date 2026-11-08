import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchRequest, SseEvent } from "@/types";
import {
  IDLE_TIMEOUT_MS,
  createSseParser,
  openSearchStream,
  parseSseEvent,
  type SseFrame,
  type StreamFailure,
} from "../sse";

const frames = (items: ReturnType<ReturnType<typeof createSseParser>["feed"]>) =>
  items.filter((item): item is SseFrame => item.kind === "frame");

describe("createSseParser（帧解析）", () => {
  it("一个 chunk 里含多个帧", () => {
    const parser = createSseParser();
    const out = frames(
      parser.feed('id: 1\nevent: trace\ndata: {"a":1}\n\nid: 2\nevent: token\ndata: {"delta":"x"}\n\n'),
    );
    expect(out.map((f) => [f.id, f.event, f.data])).toEqual([
      ["1", "trace", '{"a":1}'],
      ["2", "token", '{"delta":"x"}'],
    ]);
  });

  it("一个帧被切在两个 chunk 之间（任意位置）", () => {
    const text = 'id: 7\nevent: token\ndata: {"delta":"hello"}\n\n';
    for (let cut = 1; cut < text.length; cut += 1) {
      const parser = createSseParser();
      const out = [...parser.feed(text.slice(0, cut)), ...parser.feed(text.slice(cut))];
      expect(frames(out)).toHaveLength(1);
      expect(frames(out)[0]).toMatchObject({ id: "7", event: "token", data: '{"delta":"hello"}' });
    }
  });

  it("\\r\\n 换行，以及 \\r 与 \\n 被切在两个 chunk 之间", () => {
    const parser = createSseParser();
    const a = parser.feed("event: token\r\ndata: 1\r\n\r\n");
    expect(frames(a)).toHaveLength(1);

    const split = createSseParser();
    const out = [
      ...split.feed("event: token\r"),
      ...split.feed("\ndata: 2\r"),
      ...split.feed("\n\r"),
      ...split.feed("\n"),
    ];
    expect(frames(out)).toHaveLength(1);
    expect(frames(out)[0]).toMatchObject({ event: "token", data: "2" });
  });

  it("只有 \\r 作为换行符（结尾的 \\r 要等下一个字节才能确定不是 \\r\\n）", () => {
    const parser = createSseParser();
    expect(frames(parser.feed("event: token\rdata: 3\r\r"))).toHaveLength(0);
    const out = frames(parser.feed("id: 2\r"));
    expect(out).toHaveLength(1);
    expect(out[0].data).toBe("3");
  });

  it("注释行（心跳）产生 comment 项而不是业务帧", () => {
    const items = createSseParser().feed(": ping\n\nevent: token\ndata: {}\n\n");
    expect(items.map((i) => i.kind)).toEqual(["comment", "frame"]);
  });

  it("多行 data 用换行拼接；data 后无空格也可解析；无 data 的帧不派发", () => {
    const parser = createSseParser();
    const out = frames(parser.feed("event: token\ndata:a\ndata: b\n\nevent: token\n\n"));
    expect(out).toHaveLength(1);
    expect(out[0].data).toBe("a\nb");
  });

  it("未完成的帧不派发", () => {
    expect(frames(createSseParser().feed("event: token\ndata: 1\n"))).toHaveLength(0);
  });
});

describe("parseSseEvent", () => {
  const frame = (event: string, data: string): SseFrame => ({ kind: "frame", id: "1", event, data });

  it("已知事件解析成带类型事件", () => {
    expect(parseSseEvent(frame("token", '{"delta":"你好"}'))).toEqual({ type: "token", data: { delta: "你好" } });
  });

  it("未知事件名被忽略", () => {
    expect(parseSseEvent(frame("future-event", "{}"))).toBeNull();
    expect(parseSseEvent(frame("message", "{}"))).toBeNull();
  });

  it("非法 JSON 被忽略", () => {
    expect(parseSseEvent(frame("token", "{oops"))).toBeNull();
    expect(parseSseEvent(frame("token", "123"))).toBeNull();
  });
});

// ------------------------------------------------------------ 网络层

const REQUEST: SearchRequest = { query: "q", focusMode: "web", engine: "tavily", scopeFilters: [] };
const encoder = new TextEncoder();

function sseResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } });
}

function frameText(id: number, type: string, data: object): string {
  return `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** 手动控制的流：测试里自己决定什么时候发数据 */
function controlledStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    stream,
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    pushBytes: (bytes: Uint8Array) => controller.enqueue(bytes),
    close: () => controller.close(),
  };
}

function collect() {
  const events: SseEvent[] = [];
  const failures: StreamFailure[] = [];
  let closed = 0;
  return {
    events,
    failures,
    get closed() {
      return closed;
    },
    handlers: {
      onEvent: (e: SseEvent) => events.push(e),
      onFailure: (f: StreamFailure) => failures.push(f),
      onClose: () => {
        closed += 1;
      },
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe("openSearchStream", () => {
  it("UTF-8 多字节字符被切在 chunk 边界时不乱码", async () => {
    const payload = encoder.encode(frameText(1, "token", { delta: "多字节字符：研报引用" }));
    const { stream, pushBytes, close } = controlledStream();
    const sink = collect();
    openSearchStream(REQUEST, sink.handlers, { fetchImpl: async () => sseResponse(stream) });
    // 在每一个字节处切开（包括汉字的中间）
    for (let i = 0; i < payload.length; i += 1) pushBytes(payload.slice(i, i + 1));
    close();
    await vi.waitFor(() => expect(sink.events).toHaveLength(1));
    expect(sink.events[0]).toEqual({ type: "token", data: { delta: "多字节字符：研报引用" } });
    expect(JSON.stringify(sink.events)).not.toContain("\uFFFD");
  });

  it("按到达顺序派发事件；收到 done 后不再触发 onClose", async () => {
    const { stream, push, close } = controlledStream();
    const sink = collect();
    openSearchStream(REQUEST, sink.handlers, { fetchImpl: async () => sseResponse(stream) });
    push(frameText(1, "token", { delta: "a" }) + frameText(2, "related", { items: ["x"] }));
    push(frameText(3, "done", { latencyMs: 1 }));
    close();
    await vi.waitFor(() => expect(sink.events).toHaveLength(3));
    await tick();
    expect(sink.events.map((e) => e.type)).toEqual(["token", "related", "done"]);
    expect(sink.closed).toBe(0);
    expect(sink.failures).toHaveLength(0);
  });

  it("流在没有 done / error 的情况下结束，触发 onClose", async () => {
    const { stream, push, close } = controlledStream();
    const sink = collect();
    openSearchStream(REQUEST, sink.handlers, { fetchImpl: async () => sseResponse(stream) });
    push(frameText(1, "token", { delta: "a" }));
    close();
    await vi.waitFor(() => expect(sink.closed).toBe(1));
  });

  it("请求前的 400 是普通 JSON：按错误处理，不当作 SSE", async () => {
    const sink = collect();
    const body = JSON.stringify({ code: 40001, msg: "query 不合法", data: { field: "query" } });
    openSearchStream(REQUEST, sink.handlers, {
      fetchImpl: async () => new Response(body, { status: 400, headers: { "content-type": "application/json" } }),
    });
    await vi.waitFor(() => expect(sink.failures).toHaveLength(1));
    expect(sink.failures[0]).toMatchObject({ kind: "api", code: 40001, message: "query 不合法" });
    expect(sink.events).toHaveLength(0);
  });

  it("后端不可达（代理返回纯文本 500）按 http 错误处理", async () => {
    const sink = collect();
    openSearchStream(REQUEST, sink.handlers, {
      fetchImpl: async () => new Response("Internal Server Error", { status: 500, headers: { "content-type": "text/plain" } }),
    });
    await vi.waitFor(() => expect(sink.failures).toHaveLength(1));
    expect(sink.failures[0]).toMatchObject({ kind: "http", status: 500 });
  });

  it("fetch 抛错按 network 错误处理", async () => {
    const sink = collect();
    openSearchStream(REQUEST, sink.handlers, {
      fetchImpl: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await vi.waitFor(() => expect(sink.failures).toHaveLength(1));
    expect(sink.failures[0].kind).toBe("network");
  });

  it("abort() 之后迟到的事件被丢弃，不触发任何回调", async () => {
    const { stream, push } = controlledStream();
    const sink = collect();
    const handle = openSearchStream(REQUEST, sink.handlers, { fetchImpl: async () => sseResponse(stream) });
    push(frameText(1, "token", { delta: "a" }));
    await vi.waitFor(() => expect(sink.events).toHaveLength(1));
    handle.abort();
    // 迟到的数据：即使还能 enqueue，也不能再回调
    try {
      push(frameText(2, "token", { delta: "late" }));
    } catch {
      // 流已被取消，enqueue 抛错也是预期
    }
    await tick();
    await tick();
    expect(sink.events).toHaveLength(1);
    expect(sink.failures).toHaveLength(0);
    expect(sink.closed).toBe(0);
  });

  it("abort() 发生在响应头到达之前，也不会回调", async () => {
    const sink = collect();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { stream, push, close } = controlledStream();
    const handle = openSearchStream(REQUEST, sink.handlers, {
      fetchImpl: async () => {
        await gate;
        return sseResponse(stream);
      },
    });
    handle.abort();
    release();
    push(frameText(1, "token", { delta: "late" }));
    close();
    await tick();
    await tick();
    expect(sink.events).toHaveLength(0);
    expect(sink.failures).toHaveLength(0);
    expect(sink.closed).toBe(0);
  });
});

describe("45 秒空闲看门狗", () => {
  it("45 秒内没有任何数据：中止并报 timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { stream, push } = controlledStream();
    const sink = collect();
    openSearchStream(REQUEST, sink.handlers, { fetchImpl: async () => sseResponse(stream) });
    await vi.advanceTimersByTimeAsync(0);
    push(frameText(1, "trace", { step: "rewriting", status: "start" }));
    await vi.advanceTimersByTimeAsync(10);
    expect(sink.events).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS - 100);
    expect(sink.failures).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(sink.failures).toHaveLength(1);
    expect(sink.failures[0].kind).toBe("timeout");
    expect(sink.failures[0].message).toContain("45");
  });

  it("心跳注释行刷新活动时间，不会误判超时", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { stream, push } = controlledStream();
    const sink = collect();
    openSearchStream(REQUEST, sink.handlers, { fetchImpl: async () => sseResponse(stream) });
    await vi.advanceTimersByTimeAsync(0);
    // 每 10 秒一次心跳，持续 120 秒
    for (let i = 0; i < 12; i += 1) {
      await vi.advanceTimersByTimeAsync(10_000);
      push(": ping\n\n");
    }
    await vi.advanceTimersByTimeAsync(10);
    expect(sink.failures).toHaveLength(0);
    // 心跳停止后 45 秒超时
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS + 10);
    expect(sink.failures).toHaveLength(1);
    expect(sink.failures[0].kind).toBe("timeout");
  });

  it("abort() 后看门狗被清除，不再触发", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { stream } = controlledStream();
    const sink = collect();
    const handle = openSearchStream(REQUEST, sink.handlers, { fetchImpl: async () => sseResponse(stream) });
    await vi.advanceTimersByTimeAsync(1000);
    handle.abort();
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS * 2);
    expect(sink.failures).toHaveLength(0);
  });
});
