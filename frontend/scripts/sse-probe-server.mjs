// M0 探针：验证 SSE 经 Next.js rewrites 转发时是否被缓冲、是否受 proxyTimeout 影响。
// 只用 Node 内置 http 模块，监听 127.0.0.1:8001。
//
// 用法：node scripts/sse-probe-server.mjs
// 路径：GET /api/probe/stream
// 可选查询参数：
//   count     推送条数，默认 10
//   interval  每条间隔毫秒，默认 300
//   delay     第一条之前的等待毫秒，默认 0（用于模拟检索阶段长时间无输出）
//   heartbeat 心跳间隔毫秒，默认 0 表示不发；大于 0 时周期性发送 SSE 注释行 ": ping"
import http from "node:http";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PROBE_PORT ?? 8001);

function toInt(value, fallback) {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  if (url.pathname !== "/api/probe/stream") {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
    return;
  }

  const count = toInt(url.searchParams.get("count"), 10);
  const interval = toInt(url.searchParams.get("interval"), 300);
  const delay = toInt(url.searchParams.get("delay"), 0);
  const heartbeat = toInt(url.searchParams.get("heartbeat"), 0);
  const started = Date.now();

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  // 先发一行注释，让客户端立即拿到响应头
  res.write(": probe-open\n\n");

  let sent = 0;
  let timer = null;
  // SSE 规范里以冒号开头的行是注释，客户端会忽略，但能让代理认为连接仍有数据流动
  const pinger = heartbeat > 0 ? setInterval(() => res.write(": ping\n\n"), heartbeat) : null;

  const tick = () => {
    sent += 1;
    const payload = JSON.stringify({ seq: sent, serverMs: Date.now() - started });
    res.write(`event: tick\nid: ${sent}\ndata: ${payload}\n\n`);
    if (sent >= count) {
      if (pinger) clearInterval(pinger);
      res.write("event: done\ndata: {}\n\n");
      res.end();
      return;
    }
    timer = setTimeout(tick, interval);
  };

  timer = setTimeout(tick, delay);

  req.on("close", () => {
    if (timer) clearTimeout(timer);
    if (pinger) clearInterval(pinger);
    if (sent < count) {
      console.log(`[probe] client closed early after ${sent}/${count} events, ${Date.now() - started}ms`);
    }
  });

  console.log(`[probe] stream start count=${count} interval=${interval} delay=${delay} heartbeat=${heartbeat}`);
});

server.listen(PORT, HOST, () => {
  console.log(`[probe] listening on http://${HOST}:${PORT}/api/probe/stream`);
});
