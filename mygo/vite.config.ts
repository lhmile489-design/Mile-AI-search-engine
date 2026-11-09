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
    // 与 mygo.config.ts devUrl 保持一致；G2 验收时 5173 被 szpu-takeout-admin 占用，
    // 验证改用 5199 完成，提交恢复契约值。复验时被占可同样临时改这里和 devUrl。
    port: 5173,
    strictPort: true,
    watch: { ignored: ["**/.mygo/**", "**/build/**"] },
  },
});
