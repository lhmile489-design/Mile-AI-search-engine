import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SseEvent } from "@/types";
import type { SearchState } from "@/store/state";
import { initialState } from "@/store/state";
import { searchReducer } from "@/store/reducer";
import type { SearchAction } from "@/store/actions";

// transport 测试：不依赖真 Go 绑定，mock @/mygo 的 SearchService 与 runtime Channel。
// 覆盖 dispatch 要求的三条：mock 序列 -> result；cancel 后迟到帧被丢弃；Go 错误 -> 错误态。

let scriptFrames: Array<{ delay: number; frame: unknown }> = [];
let scriptError: Error | null = null;

// mock mygo-runtime 的 Channel：close() 终止迭代；close 后 push 无效（模拟 Go 端停发）。
vi.mock("mygo-runtime", async (importOriginal) => {
  const original = await importOriginal<typeof import("mygo-runtime")>();
  class MockChannel<T> {
    private queue: T[] = [];
    private waiters: Array<(v: IteratorResult<T>) => void> = [];
    private closed = false;

    close() {
      if (this.closed) return;
      this.closed = true;
      this.waiters.splice(0).forEach((w) => w({ value: undefined, done: true }));
    }

    isClosed() {
      return this.closed;
    }

    push(v: T) {
      if (this.closed) return; // Go 端在 ctx 取消后停发，等价
      const w = this.waiters.shift();
      if (w) w({ value: v, done: false });
      else this.queue.push(v);
    }

    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (this.queue.length) {
          yield this.queue.shift() as T;
          continue;
        }
        if (this.closed) return;
        const v = await new Promise<IteratorResult<T>>((res) => this.waiters.push(res));
        if (v.done) return;
        yield v.value as T;
      }
    }
  }
  return { ...original, Channel: MockChannel };
});

// mock @/mygo 的 SearchService.search：按 scriptFrames 重放，scriptError 时 reject。
vi.mock("@/mygo", () => ({
  SearchService: {
    search: (_req: unknown, ch: { push: (f: unknown) => void; isClosed: () => boolean; close: () => void }) =>
      (async () => {
        try {
          for (const step of scriptFrames) {
            if (step.delay > 0) await new Promise((r) => setTimeout(r, step.delay));
            if (ch.isClosed()) break; // 页面 abort 后 Go 停发
            ch.push(step.frame);
          }
          if (scriptError) throw scriptError;
        } finally {
          ch.close(); // Go 方法返回（无论成功或出错）都会关掉 channel = 流结束
        }
      })(),
  },
}));

import { openMyGoStream, type StreamFailure } from "../transport";

const REQ = { query: "q", focusMode: "web", engine: "tavily", scopeFilters: [] } as const;

function runReducer(frames: SseEvent[], failure?: StreamFailure): SearchState {
  let state: SearchState = { ...initialState, phase: "retrieving", runId: 1, query: "q" };
  const dispatch = (a: SearchAction) => {
    state = searchReducer(state, a);
  };
  for (const e of frames) dispatch({ type: "STREAM_EVENT", runId: 1, event: e });
  if (failure) dispatch({ type: "STREAM_FAILURE", runId: 1, failure });
  return state;
}

const traceFrame = (step: string, status: string) => ({
  type: "trace",
  trace: { step, status, atMs: 1, elapsedMs: null, message: "", detail: null, cacheHit: false },
});
const tokenFrame = (delta: string) => ({ type: "token", token: { delta } });
const doneFrame = () => ({
  type: "done",
  done: {
    historyId: null, latencyMs: 1,
    stageTimings: { rewritingMs: 0, searchingMs: 0, reasoningMs: 0, generatingMs: 0, finalizingMs: 0 },
    firstTokenMs: null, tokenStats: null, citations: [], takeaways: null, consensus: null,
    engine: "tavily", enginesUsed: ["tavily"], degraded: false, sourceCount: 0, charCount: 0, cacheHit: false,
  },
});

const settle = () => new Promise((r) => setTimeout(r, 30));

describe("openMyGoStream", () => {
  beforeEach(() => {
    scriptFrames = [];
    scriptError = null;
  });

  it("事件序列驱动 reducer 到 result", async () => {
    scriptFrames = [
      { delay: 0, frame: traceFrame("rewriting", "start") },
      { delay: 0, frame: traceFrame("searching", "start") },
      { delay: 0, frame: tokenFrame("## 标题\n\n") },
      { delay: 0, frame: tokenFrame("正文 [1]。") },
      { delay: 0, frame: doneFrame() },
    ];
    const events: SseEvent[] = [];
    let failure: StreamFailure | undefined;
    let closed = false;
    const handle = openMyGoStream(REQ, {
      onEvent: (e) => events.push(e),
      onFailure: (f) => { failure = f; },
      onClose: () => { closed = true; },
    });
    await settle();
    handle.abort();

    const state = runReducer(events, failure);
    expect(state.phase).toBe("result");
    expect(state.report).toContain("标题");
    expect(state.generating).toBe(false);
    expect(closed).toBe(false); // done 终止，不走 onClose 分支
    expect(failure).toBeUndefined();
  });

  it("abort 后迟到帧被丢弃", async () => {
    // 帧间有延迟：第一帧到 -> abort -> 后续帧 Go 停发；即使漏发 dead 位也拦截
    scriptFrames = [
      { delay: 0, frame: tokenFrame("first") },
      { delay: 20, frame: tokenFrame("late") },
      { delay: 20, frame: doneFrame() },
    ];
    const events: SseEvent[] = [];
    const handle = openMyGoStream(REQ, {
      onEvent: (e) => events.push(e),
      onFailure: () => {},
      onClose: () => {},
    });
    await new Promise((r) => setTimeout(r, 5)); // 只等第一帧
    handle.abort();
    await settle();
    const tokenDeltas = events.filter((e) => e.type === "token").map((e) => e.data.delta);
    expect(tokenDeltas).toEqual(["first"]);
    expect(tokenDeltas).not.toContain("late");
  });

  it("Go 返回错误时进入错误态", async () => {
    // 真 Go 绑定 reject 的是 CallError（name 判别），message 即 Go 的错误文本
    const err = new Error("not implemented (G3): pipeline arrives in the next milestone");
    err.name = "CallError";
    scriptError = err;
    let failure: StreamFailure | undefined;
    openMyGoStream(REQ, {
      onEvent: () => {},
      onFailure: (f) => { failure = f; },
      onClose: () => {},
    });
    await settle();
    expect(failure).toBeDefined();
    expect(failure?.message).toContain("not implemented");

    const state = runReducer([], failure);
    // retrieving 阶段出错 -> 回 initial + 错误条，title 带 Go 的「未实现」原因
    expect(state.phase).toBe("initial");
    expect(state.error?.title).toContain("not implemented");
    // CallError 不带契约 code（null）→ describeStreamFailure 判为非可重试
    expect(state.error?.retryable).toBe(false);
  });
});
