import { openSearchStream, type OpenStream } from "./sse";

// 流传输的唯一入口。
// 开发期 mock 只通过 fetchImpl 注入，真实的 SSE 解析和 45 秒看门狗照常运行。
// 下面的 if 在生产构建里是编译期常量（NODE_ENV 被内联为 "production"），
// 整个 import("@/mocks") 分支会被死代码消除，.next 产物里不会出现 mock 文件。

let cached: Promise<OpenStream> | null = null;

export function resolveOpenStream(): Promise<OpenStream> {
  if (cached) return cached;
  cached = (async (): Promise<OpenStream> => {
    if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_USE_MOCK === "1") {
      const { createMockOpenStream } = await import("@/mocks");
      return createMockOpenStream(openSearchStream);
    }
    return openSearchStream;
  })();
  return cached;
}
