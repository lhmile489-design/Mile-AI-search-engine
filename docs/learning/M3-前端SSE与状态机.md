# M3 学习笔记：前端 SSE 解析、状态机与流式渲染

> 日期：2026-11-08 · 对应里程碑：M3 前端三屏（前端提交 `d283682`、`61623ef`、`5c9fc9b`、`3f0938e`）
> 契约：`docs/接口设计.md` §2–§3、§7；交互：`PRODUCT.md` §3–§4

## 这一阶段做了什么

前端把契约里的 SSE 事件流接成了三个屏幕：提交问题进入检索推理态，第一个 `token` 到达后切到研报工作台，点角标能在证据抽屉里定位并高亮被引句子，历史记录能直接还原不重新检索。核心是三块：能正确处理粘包半帧的 SSE 解析器、单一 reducer 状态机、整体重渲染的流式 Markdown。62 个单测加真实后端联调全部通过。

## 核心概念

**SSE（Server-Sent Events）**：服务端用一个不关闭的 HTTP 响应持续推送文本帧。每帧由 `id:`、`event:`、`data:` 几行组成，以空行结束；以 `:` 开头的行是注释。本项目的帧格式见契约 §2.4。

**为什么不用 `EventSource`**：它只支持 GET，没法带 JSON 请求体，也拿不到请求前的 400 响应。所以用 `fetch` 加 `ReadableStream` 自己解析。入口见 `frontend/src/lib/sse.ts:125` 的 `openSearchStream`。

**粘包与半帧**：网络层不保证一个 chunk 正好对应一帧。一个 chunk 可能含好几帧，一帧也可能被切在两个 chunk 之间，甚至切在一个汉字的 UTF-8 字节中间。解析器要在缓冲区里攒，攒够一帧才派发，见 `sse.ts:23`。

**单一 reducer 状态机**：全局只有 `initial / retrieving / result` 三态，所有变化通过 `searchReducer`（`frontend/src/store/reducer.ts:179`）这一个纯函数。同一个按键（比如 Esc）在不同状态下含义不同，集中在一处才能用单测穷举。

**迟到事件（stale event）**：中止或重新提交后，网络里可能还有已经在路上的事件。如果照常处理，新旧数据会混在一起。前端用两层防护：网络层的 `dead` 标志，状态层的 `runId`。

**空闲看门狗**：`IDLE_TIMEOUT_MS = 45_000`（`sse.ts:12`）。45 秒内既没有业务事件也没有心跳，就主动中止并报「连接超时」。它是后端心跳的兜底，不能代替心跳。

**流式 Markdown 整体重渲染**：增量文本可能切在 `[1`、`**` 或代码围栏中间，所以每次对累计全文重新解析，半截语法下一帧补全后自然修正，不做增量拼接。

## 流程图

```text
fetch POST /api/search/stream
  │  content-type 是 json -> 请求前的 400，按 API 错误处理
  ▼
reader.read() -> TextDecoder(stream:true) -> parser.feed(text)
  │                                           │
  │                         帧 -> 事件解析 -> dispatch(STREAM_EVENT, runId)
  │                         注释行(: ping) -> 只刷新"最近活动时间"
  ▼
searchReducer
  trace   -> 时间轴状态与耗时
  sources -> raw 追加去重 / ranked 整体替换
  token   -> 累计正文；首个 token: retrieving -> result
  done    -> generating=false，存 citations
  error   -> 保留已生成内容，按 retryable 显示重试
  ABORT   -> runId+1；之后迟到事件在入口被丢弃
```

## 关键代码走读

### 1. 半帧与 `\r\n`（`sse.ts:54–71`）

```ts
feed(chunk: string) {
  buffer += chunk;
  const out: SseItem[] = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const ch = buffer[i];
    if (ch !== "\n" && ch !== "\r") continue;
    if (ch === "\r" && i === buffer.length - 1) break;   // 等下一个 chunk
    handleLine(buffer.slice(start, i), out);
    if (ch === "\r" && buffer[i + 1] === "\n") i += 1;
    start = i + 1;
  }
  buffer = buffer.slice(start);   // 剩下的半行留给下次
  return out;
}
```

- `buffer` 在两次 `feed` 之间保留，所以帧被切在任意位置都能还原。
- 缓冲区以 `\r` 结尾时不能立刻当作换行：下一个 chunk 可能以 `\n` 开头，凑成 `\r\n`。所以 `break` 等下一次。
- 空行在 `handleLine` 里表示一帧结束（`sse.ts:30–38`），没有 `data` 的帧不派发，这是 SSE 规范的要求。

### 2. 迟到事件的两层防护

网络层（`sse.ts:130` 起）：一个 `dead` 标志，`abort()` 置位，之后每个回调入口都 `if (dead) return`（`sse.ts:142`、`154`、`173`、`208`、`211`）。

状态层（`reducer.ts:200–201`）：

```ts
// 迟到事件：中止 / 重新提交 / 恢复历史都会让 runId 前进
if (action.runId !== state.runId || state.phase === "initial") return state;
```

两层缺一不可：`dead` 挡住网络层还没来得及派发的回调；`runId` 挡住已经进了派发队列、但状态已经翻篇的事件。每个流事件在创建时带上当时的 `runId`，所以旧流的事件天然对不上。

### 3. Esc 的两种中止（`reducer.ts:209–219`）

检索阶段中止回 `initial` 并把问题放回输入框；生成阶段中止则留在 `result`，保留已生成内容并标记 `aborted`。两个分支都让 `runId + 1`，保证之后的迟到事件被丢弃。

### 4. 高亮为什么直接 `slice`（`frontend/src/lib/highlight.ts:36–47`）

后端下发的 `highlight.start/end` 是 UTF-16 码元偏移，而 JS 的 `String.prototype.slice` 按同样的单位索引，所以 `passage.slice(start, end)` 直接可用。如果先转成码点数组再切，遇到 emoji 之后整体错位。单测专门覆盖了中文和 emoji 代理对。

## 踩坑与取舍

| 问题 | 做法 |
| --- | --- |
| 点角标后焦点丢失 | `react-markdown` 的 `components` 如果闭包了会变的值，每次状态变化组件类型都变，整批角标被卸载重建。改用 context 传值，保持组件类型稳定 |
| 手写 `.hljs-*` 样式被 Tailwind 清掉 | 这些类名只出现在运行时生成的 HTML，放进 `@layer components` 会被清除，必须放在 `@layer` 之外 |
| 流式期间角标无高亮 | 偏移只在 `done` 和历史快照里才有，流式期间只能定位卡片。这是契约决定的，不是缺陷 |
| mock 如何不污染生产 | mock 只替换 `fetch`，真实的解析和看门狗照常运行；生产构建靠 `NODE_ENV` 编译期常量把动态 import 整个消除，并用搜索 `.next` 产物验证 |
| 契约与实现的缝隙 | 联调发现三处文档缺口（config 元素结构、40002 含义、请求体字段名），已回写 `docs/接口设计.md` 和 `PRODUCT.md` |

## 延伸阅读

- MDN：`ReadableStream` 与 `fetch` 流式读取：https://developer.mozilla.org/en-US/docs/Web/API/Streams_API/Using_readable_streams
- MDN：`TextDecoder.decode` 的 `stream` 选项：https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/decode
- MDN：`AbortController`：https://developer.mozilla.org/en-US/docs/Web/API/AbortController
- React 官方文档：用 reducer 管理状态：https://react.dev/learn/extracting-state-logic-into-a-reducer

## 自测题

**1. 一个 chunk 以 `\r` 结尾时，为什么解析器不能立刻把它当作行结束？**

<details>
<summary>答案</summary>

因为换行可能是 `\r\n`，下一个 chunk 的第一个字符可能是 `\n`。如果立刻处理 `\r`，随后到来的 `\n` 会被当成一个新的空行，导致错误地结束一帧。所以解析器要等下一次 `feed` 再决定。

</details>

**2. 已经有 `dead` 标志了，为什么 reducer 里还要 `runId`？**

<details>
<summary>答案</summary>

`dead` 只能拦住网络层之后的回调。有些事件在中止之前就已经进了派发队列（比如按帧合并 token 时暂存的内容），它们不会再经过 `dead` 检查，到达 reducer 时状态已经翻篇。`runId` 让 reducer 自己能识别「这个事件属于上一次检索」，两层分别防不同位置的迟到。

</details>

**3. 流式输出的 Markdown 为什么每次对全文重渲染，而不是只渲染新增的片段？**

<details>
<summary>答案</summary>

因为增量边界由模型决定，可能切在 `[1`、`**` 或代码围栏中间。只渲染新增片段会得到错误的解析结果，也没法修正之前的片段。整体重渲染时，半截语法在下一帧补全后会自然得到正确结果。代价是计算量变大，所以用按帧合并 token 和延迟渲染来控制开销。

</details>
