import type { ApiEnvelope } from "@/types";

// 所有非流式请求走这一层（PRODUCT.md §9）。
// 统一响应体 {code, msg, data}，成功码是整数 200；其余一律抛 ApiError。

export const API_BASE = "/api";

export type ApiErrorKind = "api" | "http" | "network";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  /** 契约错误码（40001 等）；kind 不是 api 时为 null */
  readonly code: number | null;
  readonly status: number | null;
  readonly data: unknown;

  constructor(init: {
    kind: ApiErrorKind;
    message: string;
    code?: number | null;
    status?: number | null;
    data?: unknown;
  }) {
    super(init.message);
    this.name = "ApiError";
    this.kind = init.kind;
    this.code = init.code ?? null;
    this.status = init.status ?? null;
    this.data = init.data ?? null;
  }
}

function isEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { code?: unknown }).code === "number" &&
    "data" in value
  );
}

/** 把已拿到的 Response 解析成统一错误或 data。SSE 请求前的 400 也复用它。 */
export async function readEnvelope<T>(response: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // 非 JSON（例如 Next 代理在后端不可达时返回的纯文本 500）
  }
  if (isEnvelope(body)) {
    if (body.code === 200) return body.data as T;
    throw new ApiError({
      kind: "api",
      message: typeof body.msg === "string" ? body.msg : "请求失败",
      code: body.code,
      status: response.status,
      data: body.data,
    });
  }
  throw new ApiError({
    kind: "http",
    message: `服务返回了无法识别的响应（HTTP ${response.status}）`,
    status: response.status,
  });
}

export type RequestOptions = Readonly<{
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}>;

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? "GET",
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (cause) {
    if (options.signal?.aborted) throw cause;
    throw new ApiError({ kind: "network", message: "网络连接失败" });
  }
  return readEnvelope<T>(response);
}
