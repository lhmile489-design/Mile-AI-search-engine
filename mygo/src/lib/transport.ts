import { Channel, isCallError, isCallError as isCallErr } from "mygo-runtime";
import { SearchService } from "@/mygo";
import type { SearchRequest, SseEvent } from "@/types";
import type {
  DonePayload,
  ErrorPayload,
  RawSource,
  RelatedPayload,
  SourceCard,
  SourcesPayload,
  StreamFrame,
  TokenPayload,
  TracePayload,
} from "@/mygo";
import type {
  DoneEvent,
  ErrorEvent,
  RawSource as UiRawSource,
  RelatedEvent,
  SourceCard as UiSourceCard,
  SourcesEvent,
  StepName,
  TokenEvent,
  TraceEvent,
} from "@/types";

// 流传输的唯一入口（mygo 版）：Channel 取代 HTTP/SSE。
// 对外仍暴露与前端一致的 OpenStream / StreamHandlers / StreamFailure，
// 这样 useSearchController 和 reducer 的接法不变——换的是传输，不是协议。

/** 空闲看门狗：45 秒内没有收到任何帧就判定连接已死（保留自 SSE 版，只提示不改状态）。 */
export const IDLE_TIMEOUT_MS = 45_000;

// ---------------------------------------------------------------- 类型（原 lib/sse.ts 的对外契约）

export type StreamFailureKind = "api" | "http" | "network" | "timeout" | "protocol";

export type StreamFailure = Readonly<{
  kind: StreamFailureKind;
  /** 契约错误码，只有 kind=api 时有值 */
  code: number | null;
  status: number | null;
  message: string;
}>;

export type StreamHandlers = Readonly<{
  onEvent: (event: SseEvent) => void;
  onFailure: (failure: StreamFailure) => void;
  /** 流正常结束但此前没有 done / error */
  onClose: () => void;
}>;

export type StreamHandle = Readonly<{ abort: () => void }>;

export type StreamOptions = Readonly<{ idleMs?: number }>;

export type OpenStream = (
  request: SearchRequest,
  handlers: StreamHandlers,
  options?: StreamOptions,
) => StreamHandle;

// ---------------------------------------------------------------- StreamFrame -> SseEvent

// Go 侧单结构体帧（写法 A）按 type 分发到与 SSE 版相同的判别联合。
// 边界收窄：mygo 生成的类型字段是宽 string（engine/step/category），前端类型是窄字面量
// 联合（SearchEngine/StepName/SourceCategory）。两侧字段名与可空性一致，只差枚举收窄，
// 数据从线下来，这里一次性断言成前端类型，组件不再感知 Go 的宽类型。
function frameToEvent(frame: StreamFrame): SseEvent | null {
  switch (frame.type) {
    case "trace": {
      if (!frame.trace) return null;
      const t = frame.trace as TracePayload;
      return { type: "trace", data: t as unknown as TraceEvent };
    }
    case "sources": {
      const s = frame.sources as SourcesPayload | undefined;
      if (!s) return null;
      if (s.phase === "raw") {
        const data: SourcesEvent = {
          phase: "raw",
          engine: s.engine,
          queryIndex: s.queryIndex ?? null,
          items: (s.raw ?? []) as unknown as ReadonlyArray<UiRawSource>,
        };
        return { type: "sources", data };
      }
      const data: SourcesEvent = {
        phase: "ranked",
        engine: s.engine,
        queryIndex: null,
        items: (s.ranked ?? []) as unknown as ReadonlyArray<UiSourceCard>,
      };
      return { type: "sources", data };
    }
    case "token": {
      if (!frame.token) return null;
      return { type: "token", data: frame.token as TokenPayload as TokenEvent };
    }
    case "related": {
      if (!frame.related) return null;
      return { type: "related", data: frame.related as RelatedPayload as RelatedEvent };
    }
    case "done": {
      if (!frame.done) return null;
      return { type: "done", data: frame.done as DonePayload as unknown as DoneEvent };
    }
    case "error": {
      if (!frame.error) return null;
      const e = frame.error as ErrorPayload;
      return { type: "error", data: { ...e, step: (e.step as StepName | "finalizing" | null) ?? null } as ErrorEvent };
    }
    default:
      return null; // 未知帧类型丢弃，向前兼容
  }
}

// Go 侧 SearchService 的 search 契约：参数与前端 SearchRequest 一致。
function toGoRequest(request: SearchRequest, runId: string) {
  return {
    runId,
    query: request.query,
    focusMode: request.focusMode,
    engine: request.engine,
    scopeFilters: [...request.scopeFilters],
  };
}

// ---------------------------------------------------------------- 真实实现：Channel 驱动

export const openMyGoStream: OpenStream = (request, handlers, options = {}) => {
  const idleMs = options.idleMs ?? IDLE_TIMEOUT_MS;
  // dead 之后任何回调都不再触发：abort() 之后迟到的帧必须丢弃
  let dead = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const channel = new Channel<StreamFrame>();
  // runId 在调用 search 之前由页面生成，Go 侧按它登记，abort 时按它精确取消。
  const runId = crypto.randomUUID();

  const stop = () => {
    dead = true;
    if (timer !== undefined) clearTimeout(timer);
    try {
      channel.close();
    } catch {
      // channel 已关闭时 close 是幂等的；防御性吞掉
    }
  };

  const armWatchdog = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      if (dead) return;
      stop();
      handlers.onFailure({
        kind: "timeout",
        code: null,
        status: null,
        message: `${Math.round(idleMs / 1000)} 秒内没有收到数据`,
      });
    }, idleMs);
  };

  const fail = (failure: StreamFailure) => {
    if (dead) return;
    stop();
    handlers.onFailure(failure);
  };

  void (async () => {
    armWatchdog();
    // 先发出调用，再 for await 消费帧。done 是方法返回的 promise：
    //   - 正常完成 = 流结束；reject = Go 侧出错（G3 前是「未实现」）。
    //   - 提前 settled 存进 result 引用，任何 early-return 路径也不会留下 unhandled rejection。
    const done = SearchService.search(toGoRequest(request, runId), channel);
    let settled: { ok: boolean; error?: unknown } | null = null;
    void Promise.resolve(done)
      .then(() => { settled = { ok: true }; })
      .catch((error: unknown) => { settled = { ok: false, error }; });

    let terminal = false;
    try {
      for await (const frame of channel) {
        if (dead) return;
        armWatchdog();
        const event = frameToEvent(frame);
        if (!event) continue;
        handlers.onEvent(event);
        if (event.type === "done" || event.type === "error") {
          terminal = true;
          stop();
          break;
        }
      }
    } catch {
      if (dead) return;
      fail({ kind: "network", code: null, status: null, message: "连接中断" });
      return;
    }

    // channel 关闭后，方法的 settled 结果可能还差一拍才落地；等它。
    if (!dead && settled === null) {
      try {
        await done;
        settled = settled ?? { ok: true };
      } catch (error) {
        settled = settled ?? { ok: false, error };
      }
    }

    if (dead) return;
    if (settled && !settled.ok) {
      // fail 内部才 stop + 回调；先调 stop() 会让 fail 里的 dead 检查把自己拦掉。
      const error = settled.error;
      if (isCallError(error)) {
        fail({ kind: "api", code: null, status: null, message: error.message });
      } else {
        fail({ kind: "network", code: null, status: null, message: "连接失败" });
      }
      return;
    }
    stop();
    // 流结束但没有收到 done / error 才算异常关闭
    if (!terminal) handlers.onClose();
  })();

  return {
    abort: () => {
      const alreadyDead = dead;
      stop();
      // 只在流还活着时通知 Go 取消这一轮；已结束的流不需要。
      if (!alreadyDead) void Promise.resolve(SearchService.cancel(runId)).catch(() => undefined);
    },
  };
};

// ---------------------------------------------------------------- SearchTransport：前端唯一的后端访问面

import type {
  AppConfig,
  HistoryDetail,
  HistoryList,
  SuggestionsData,
} from "@/types";
import { ApiError } from "./http";

// dispatch 建议的单一传输接口：流 + 非流式全收口到一处，便于整体替换成 mock。
export type SearchTransport = Readonly<{
  openStream: OpenStream;
  getConfig(): Promise<AppConfig>;
  getSuggestions(): Promise<SuggestionsData>;
  listHistory(page: number, pageSize: number, q: string): Promise<HistoryList>;
  getHistory(id: string): Promise<HistoryDetail>;
  deleteHistory(id: string): Promise<{ deleted: boolean }>;
  saveSettings(s: { llmApiKey?: string; tavilyApiKey?: string }): Promise<void>;
}>;

// Go 侧出错 reject 的是 CallError；非流式路径包成 ApiError(kind:"api")，code 为 null
//（Go stub 不带契约码）。历史恢复分支按 ApiError 判。
async function unwrap<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (isCallErr(error)) {
      throw new ApiError({ kind: "api", message: error.message, code: null });
    }
    throw new ApiError({ kind: "network", message: "连接失败" });
  }
}

const myGoTransport: SearchTransport = {
  openStream: openMyGoStream,
  getConfig: () => unwrap<AppConfig>(SearchService.getConfig() as Promise<AppConfig>),
  getSuggestions: () =>
    unwrap<SuggestionsData>(SearchService.getSuggestions() as Promise<SuggestionsData>),
  listHistory: (page, pageSize, q) =>
    unwrap<HistoryList>(SearchService.listHistory(page, pageSize, q) as Promise<HistoryList>),
  getHistory: (id) => unwrap<HistoryDetail>(SearchService.getHistory(id) as Promise<HistoryDetail>),
  deleteHistory: (id) =>
    unwrap<{ deleted: boolean }>(SearchService.deleteHistory(id).then(() => ({ deleted: true }))),
  saveSettings: (s) => unwrap<void>(SearchService.saveSettings(s)),
};

// ---------------------------------------------------------------- 解析入口（mock 门控）

let cached: Promise<SearchTransport> | null = null;

export function resolveTransport(): Promise<SearchTransport> {
  if (cached) return cached;
  cached = (async (): Promise<SearchTransport> => {
    // 生产构建里 DEV 是编译期常量 false，整个 import("@/mocks") 分支被死代码消除。
    if (import.meta.env.DEV && import.meta.env.VITE_USE_MOCK === "1") {
      const { createMockTransport } = await import("@/mocks");
      return createMockTransport();
    }
    return myGoTransport;
  })();
  return cached;
}

// 兼容旧签名：controller 只需要 openStream。
export function resolveOpenStream(): Promise<OpenStream> {
  return resolveTransport().then((t) => t.openStream);
}
