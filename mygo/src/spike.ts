// G1 probe driver. Uses the raw mygo runtime API (window.mygo) rather than the
// generated src/mygo.ts, so the shipping client never carries Spike methods.
import { call, Channel } from "mygo-runtime";

interface Tick { seq: number; body: string }
interface BurstResult { sent: number; millis: number; sendErr: boolean; firstNano: number }

const out = (s: string) => {
  const el = document.getElementById("out")!;
  el.textContent += "\n" + s;
  console.log("[spike]", s);
  (window as any).__spikeLog = ((window as any).__spikeLog || "") + "\n" + s;
  call("Spike.Report", s).catch(() => {});
};

const setOut = (s: string) => {
  document.getElementById("out")!.textContent = s;
  (window as any).__spikeLog = s;
};

// --- Burst: high-rate small frames, count drops / reorder / latency ---
async function burst(n = 2000, intervalMs = 0) {
  setOut(`burst n=${n} interval=${intervalMs}ms ...`);
  const ch = new Channel<Tick>();
  let got = 0, lastSeq = -1, reorder = 0, firstAt = 0;
  const t0 = performance.now();
  const done = call("Spike.Burst", n, intervalMs, ch) as unknown as Promise<BurstResult>;
  for await (const f of ch) {
    if (got === 0) firstAt = performance.now() - t0;
    if (f.seq !== lastSeq + 1) reorder++;
    lastSeq = f.seq;
    got++;
  }
  const total = performance.now() - t0;
  const res = await done;
  out(`BURST done: sent=${res.sent} got=${got} dropped=${res.sent - got} reorder=${reorder} ` +
      `firstAt=${firstAt.toFixed(1)}ms total=${total.toFixed(0)}ms goMillis=${res.millis} sendErr=${res.sendErr}`);
}

// --- Flow: large frames to engage the 1 MiB backpressure window ---
async function flow(frames = 12) {
  setOut(`flow frames=${frames} (each ~256KiB) ...`);
  const ch = new Channel<Tick>();
  let got = 0, bytes = 0;
  const t0 = performance.now();
  const done = call("Spike.Flow", frames, ch) as unknown as Promise<void>;
  for await (const f of ch) {
    got++; bytes += f.body.length;
    await new Promise(r => setTimeout(r, 120)); // slow consumer
  }
  const total = performance.now() - t0;
  await done;
  out(`FLOW done: got=${got} MiB=${(bytes / 1048576).toFixed(1)} total=${total.toFixed(0)}ms`);
}

// --- Slow: page breaks mid-stream; Go must see Send fail + ctx cancel ---
let slowCh: Channel<Tick> | null = null;
async function slow() {
  setOut("slow: streaming 1/s; auto-breaks after 3 ...");
  slowCh = new Channel<Tick>();
  let got = 0;
  const done = call("Spike.Slow", slowCh) as unknown as Promise<void>;
  try {
    for await (const f of slowCh) {
      got++;
      out(`slow got seq=${f.seq}`);
      if (got >= 3) { out("slow: page breaking out of for-await"); break; }
    }
    out("slow: stream ended without break");
  } finally {
    const r = await done.then(() => "resolved").catch((e: any) => "rejected: " + (e?.message ?? e));
    out(`SLOW done: pageGot=${got} call=${r} (expect rejected=canceled)`);
  }
}

// --- Task 4: LLM streaming ---
async function llm(prompt = "用一句话解释什么是 RAG") {
  setOut(`llm: streaming "${prompt}" ...`);
  const ch = new Channel<{ delta: string; seq: number }>();
  const t0 = performance.now();
  let text = "";
  const done = call("Spike.LLMStream", prompt, ch) as unknown as Promise<{
    firstTokenMs: number; totalMs: number; chunks: number; chars: number;
  }>;
  for await (const f of ch) text += f.delta;
  const stats = await done;
  out(`LLM done: firstToken=${stats.firstTokenMs}ms total=${stats.totalMs}ms ` +
      `chunks=${stats.chunks} chars=${stats.chars} wall=${(performance.now()-t0).toFixed(0)}ms`);
  out(`LLM text: ${text.slice(0, 200)}`);
}

// --- Task 3: cancel real external calls mid-flight ---
async function cancelTest(n = 5, waitMs = 2000) {
  setOut(`cancel: firing ${n} concurrent Tavily, closing channel after ${waitMs}ms ...`);
  const ch = new Channel<{ title: string; url: string }>();
  const done = call("Spike.TavilyBurst", n, ch) as unknown as Promise<void>;
  let got = 0;
  const timer = setTimeout(() => { out("cancel: closing channel now"); ch.close(); }, waitMs);
  try {
    for await (const f of ch) { got++; out(`cancel got: ${f.url}`); }
    out("cancel: stream ended");
  } finally {
    clearTimeout(timer);
    const r = await done.then(() => "resolved").catch((e: any) => "rejected: " + (e?.message ?? e));
    out(`CANCEL done: pageGot=${got} call=${r} — check Go log for started/done/canceled`);
  }
}

// --- Task 4.1: single real Tavily search ---
async function tavily(query = "FlashAttention-3 throughput") {
  setOut(`tavily: "${query}" ...`);
  try {
    const res = await call("Spike.Tavily", query) as unknown as Array<{
      title: string; url: string; content: string; score: number; published_date: string;
    }>;
    out(`TAVILY ok: ${res.length} results`);
    res.forEach((r, i) => out(`  [${i}] score=${r.score} date=${r.published_date || "null"} ${r.url}\n      ${r.title}`));
    if (res[0]) out(`  field keys: ${Object.keys(res[0]).join(",")}`);
  } catch (e: any) {
    out(`TAVILY error: ${e?.message ?? e}`);
  }
}

document.getElementById("burst")!.onclick = () => void burst(2000, 0);
document.getElementById("flow")!.onclick = () => void flow(12);
document.getElementById("slow")!.onclick = () => void slow();
document.getElementById("slowstop")!.onclick = () => slowCh?.close();

// Auto-run the whole probe sequence once the runtime is up: Burst → Flow →
// Slow (which self-breaks). Each reports via Spike.Report into the dev log.
async function autoRun() {
  const mode = new URLSearchParams(location.search).get("probe");
  try {
    switch (mode) {
      case "tavily": await tavily(); break;
      case "llm": await llm(); break;
      case "cancel": await cancelTest(); break;
      case "burst": await burst(2000, 0); break;
      case "flow": await flow(12); break;
      case "slow": await slow(); break;
      default:
        await burst(2000, 0); await flow(12); await slow();
    }
    out("AUTORUN COMPLETE");
  } catch (e: any) {
    out("AUTORUN ERROR: " + (e?.message ?? e));
  }
}
if (new URLSearchParams(location.search).has("auto")) {
  void autoRun();
}
(window as any).__runBurst = burst;
(window as any).__runFlow = flow;
(window as any).__runSlow = slow;
(window as any).__runTavily = tavily;
(window as any).__runLLM = llm;
(window as any).__runCancel = cancelTest;
