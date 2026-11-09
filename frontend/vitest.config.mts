import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 单元测试只覆盖纯逻辑（SSE 解析、reducer、角标、高亮），在 node 环境运行，不需要 jsdom。
// tsconfig 的 jsx 是 "preserve"（交给 Next 处理），这里让编译器用自动运行时处理 .tsx 测试。
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: ["src/**/*.test.{ts,tsx}"] },
});
