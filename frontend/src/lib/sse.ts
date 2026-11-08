import type { SearchRequest, SseEvent } from "@/types";
import { SSE_EVENT_NAMES } from "@/types";
import { API_BASE, ApiError, readEnvelope } from "./http";

// SSE 客户端：fetch + ReadableStream（EventSource 只支持 GET，无法带 JSON 请求体）。
// 分三层，便于单测：
//   1. createSseParser   纯函数式帧解析：处理粘包、半帧、\r\n、注释行
//   2. parseSseEvent     帧 -> 带类型事件，未知事件名丢弃
//   3. openSearchStream  网络层：content-type 分流、45 秒空闲看门狗、可取消

/** 空闲看门狗：后端每 10 秒发一次心跳，45 秒内既没有业务事件也没有心跳就判定连接已死。 */
export const IDLE_TIMEOUT_MS = 45_000;

// ---------------------------------------------------------------- 1. 帧解析

export type SseFrame = Readonly<{ kind: "frame"; id: string | null; event: string; data: string }>;
/** 以 ":" 开头的注释行（心跳 ": ping"）。不产生业务事件，但表示连接还活着。 */
export type SseComment = Readonly<{ kind: "comment"; text: string }>;
export type SseItem = SseFrame | SseComment;

export type SseParser = Readonly<{ feed: (chunk: string) => ReadonlyArray<SseItem> }>;

export function createSseParser(): SseParser {
  let buffer = "";
  let id: string | null = null;
  let event = "";
  let dataLines: string[] = [];

  function handleLine(line: string, out: SseItem[]): void {
    if (line === "") {
      // 空行 = 一帧结束。没有 data 的帧按规范不派发。
      if (dataLines.length > 0) {
        out.push({ kind: "frame", id, event: event || "message", data: dataLines.join("\n") });
      }
      id = null;
      event = "";
      dataLines = [];
      return;
    }
    if (line.startsWith(":")) {
      out.push({ kind: "comment", text: line.slice(1).trim() });
      return;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") dataLines.push(value);
    else if (field === "event") event = value;
    else if (field === "id") id = value;
    // retry 与未知字段忽略
  }

  return {
    feed(chunk: string): ReadonlyArray<SseItem> {
      buffer += chunk;
      const out: SseItem[] = [];
      let start = 0;
      for (let i = 0; i < buffer.length; i += 1) {
        const ch = buffer[i];
        if (ch !== "\n" && ch !== "\r") continue;
        // 缓冲区以 \r 结尾时，下一个 chunk 可能以 \n 开头，必须等下一次再判断
        if (ch === "\r" && i === buffer.length - 1) break;
        handleLine(buffer.slice(start, i), out);
        if (ch === "\r" && buffer[i + 1] === "\n") i += 1;
        start = i + 1;
      }
      // 剩余的半行留到下一次 feed
      buffer = buffer.slice(start);
      return out;
    },
  };
}

// ---------------------------------------------------------------- 2. 事件解析

const KNOWN: ReadonlySet<string> = new Set(SSE_EVENT_NAMES);

/** 未知事件名、非法 JSON 一律返回 null（丢弃），前端对后端新增事件保持向前兼容。 */
export function parseSseEvent(frame: SseFrame): SseEvent | null {
  if (!KNOWN.has(frame.event)) return null;
  try {
    const data: unknown = JSON.parse(frame.data);
    if (typeof data !== "object" || data === null) return null;
    return { type: frame.event, data } as SseEvent;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- 3. 网络层

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
  /** 建立流之前的错误（400 / 网络）、看门狗超时、读取中断 */
  onFailure: (failure: StreamFailure) => void;
  /** 服务端正常关闭，且此前没有收到 done / error */
  onClose: () => void;
}>;

export type StreamHandle = Readonly<{ abort: () => void }>;

export type StreamOptions = Readonly<{
  idleMs?: number;
  /** 测试与开发期 mock 注入点；默认用全局 fetch */
  fetchImpl?: typeof fetch;
}>;

export type OpenStream = (
  request: SearchRequest,
  handlers: StreamHandlers,
  options?: StreamOptions,
) => StreamHandle;

export const openSearchStream: OpenStream = (request, handlers, options = {}) => {
  const idleMs = options.idleMs ?? IDLE_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const controller = new AbortController();
  // dead 之后任何回调都不再触发：abort() 之后迟到的事件必须丢弃
  let dead = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    dead = true;
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
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
        message: `${Math.round(idleMs / 1000)} 秒内没有收到服务端数据`,
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
    let response: Response;
    try {
      response = await doFetch(`${API_BASE}/search/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
    } catch {
      fail({ kind: "network", code: null, status: null, message: "网络连接失败" });
      return;
    }
    if (dead) return;

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      // 请求前的校验错误（40001 / 40002）是普通 JSON，不是 SSE
      try {
        await readEnvelope<unknown>(response);
        fail({ kind: "protocol", code: null, status: response.status, message: "服务端没有返回事件流" });
      } catch (error) {
        if (error instanceof ApiError) {
          fail({
            kind: error.kind === "api" ? "api" : "http",
            code: error.code,
            status: error.status,
            message: error.message,
          });
        } else {
          fail({ kind: "network", code: null, status: null, message: "网络连接失败" });
        }
      }
      return;
    }
    if (!response.ok || !response.body) {
      fail({ kind: "http", code: null, status: response.status, message: `HTTP ${response.status}` });
      return;
    }

    const reader = response.body.getReader();
    // stream:true：多字节字符被切在 chunk 边界时，解码器会缓存半个字符，下个 chunk 再补全
    const decoder = new TextDecoder("utf-8");
    const parser = createSseParser();

    try {
      while (!dead) {
        const { done, value } = await reader.read();
        if (dead) return;
        if (done) break;
        for (const item of parser.feed(decoder.decode(value, { stream: true }))) {
          if (dead) return;
          armWatchdog(); // 业务帧和心跳注释都刷新「最近活动时间」
          if (item.kind === "comment") continue;
          const event = parseSseEvent(item);
          if (!event) continue;
          handlers.onEvent(event);
          if (event.type === "done" || event.type === "error") {
            stop(); // 终止事件之后不再读，主动释放连接
            return;
          }
        }
      }
    } catch {
      fail({ kind: "network", code: null, status: null, message: "连接中断" });
      return;
    }
    if (dead) return;
    stop();
    // 走到这里说明流结束时没有收到 done / error
    handlers.onClose();
  })();

  return { abort: stop };
};
