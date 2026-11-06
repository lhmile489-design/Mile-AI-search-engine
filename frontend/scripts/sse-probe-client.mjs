// M0 探针客户端：记录每条 SSE 事件相对请求发出的到达时间。
// 用法：node scripts/sse-probe-client.mjs <url> [label]
// 输出：每条事件一行，最后一行是汇总。
const url = process.argv[2];
const label = process.argv[3] ?? url;
if (!url) {
  console.error("usage: node scripts/sse-probe-client.mjs <url> [label]");
  process.exit(2);
}

const t0 = Date.now();
const arrivals = [];
let buffer = "";

try {
  const res = await fetch(url, { headers: { Accept: "text/event-stream" } });
  const headersMs = Date.now() - t0;
  const enc = res.headers.get("content-encoding") ?? "none";
  console.log(`[${label}] status=${res.status} headers@${headersMs}ms content-encoding=${enc}`);

  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    const now = Date.now() - t0;
    buffer += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const event = /^event: (.+)$/m.exec(block)?.[1];
      if (!event) continue;
      const data = /^data: (.+)$/m.exec(block)?.[1] ?? "";
      arrivals.push(now);
      console.log(`[${label}] +${String(now).padStart(6)}ms event=${event} data=${data}`);
    }
  }
} catch (err) {
  console.log(`[${label}] ERROR after ${Date.now() - t0}ms: ${err.cause?.code ?? ""} ${err.message}`);
}

const gaps = arrivals.slice(1).map((v, i) => v - arrivals[i]);
const spread = arrivals.length ? arrivals[arrivals.length - 1] - arrivals[0] : 0;
console.log(
  `[${label}] SUMMARY events=${arrivals.length} first=${arrivals[0] ?? "-"}ms last=${arrivals.at(-1) ?? "-"}ms spread=${spread}ms minGap=${gaps.length ? Math.min(...gaps) : "-"}ms total=${Date.now() - t0}ms`,
);
