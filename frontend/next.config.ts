import type { NextConfig } from "next";

// 把 /api 转发到本机后端，浏览器始终同源访问，不需要 CORS。dev 和生产（next start）都生效。
// BACKEND_ORIGIN 在 next build 时写进 .next/routes-manifest.json，必须在构建时设置；
// 只在 next start 时设置不生效（M0 实测，见 docs/依赖核实.md §2.3）。
// SSE 经此转发不缓冲，但 Next 内部代理有 30s 空闲超时，后端需每 10s 发 ": ping" 心跳（M0 Q4）。
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;
