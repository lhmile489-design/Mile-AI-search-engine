// mygo 版没有 HTTP 层。保留 ApiError 类型供历史恢复 / 设置页的错误分支复用。
// kind=api 对应 Go 侧返回的契约错误（CallError），code 携带契约错误码。

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
