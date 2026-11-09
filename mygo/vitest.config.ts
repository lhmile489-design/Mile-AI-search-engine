import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 单元测试只覆盖纯逻辑（reducer、citations、highlight、openui、transport），node 环境。
// jsx 用 esbuild 自动运行时，不用 React 17 的 jsxRuntime 配置。
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: ["src/**/*.test.{ts,tsx}"] },
});
