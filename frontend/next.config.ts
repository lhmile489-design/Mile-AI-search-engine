import type { NextConfig } from "next";

// 开发环境把 /api 转发到本机后端，浏览器始终同源访问，不需要 CORS。
// 注意：SSE 经 rewrites 转发时是否被缓冲，需在 M3 前实测（PRD §13 风险表）。
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;
