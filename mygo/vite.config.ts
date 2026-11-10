import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // 与前端一致的导入别名，移植过来的组件 import 不用改。
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    // The app loads this address during `mygo dev` (devUrl in mygo.config.ts).
    // 与 mygo.config.ts devUrl 保持一致。5173 常被本机其他项目占用，G3a 起统一用 5317。
    // 改端口时这里和 devUrl 必须同时改，strictPort 保证占用时直接报错而不是悄悄换端口。
    port: 5317,
    strictPort: true,
    watch: { ignored: ["**/.mygo/**", "**/build/**"] },
  },
});
