# M0 学习笔记：外部依赖实测与 SSE 基础

> 日期：2026-11-06 · 对应里程碑：M0 外部依赖核实
> 素材来源：前端汇报（`frontend/docs/依赖核实.md`）、后端汇报（`backend/docs/外部依赖实测.md`）、主调度复核

## 这一阶段做了什么

动手写业务代码前，先把教程里提到的每个外部依赖实际调用了一遍：DeepSeek 大模型接口、DeepSeek 搜索端点、Tavily 搜索、QuickRouter Jev 分类服务、OpenUI 渲染包。前端用一个探针服务实测了 SSE 经 Next.js 转发后能否逐条到达。结论是教程有好几处写法和真实接口对不上，如果照抄，有的地方会直接报错，有的地方不报错，但结果是空的。Jev 因为缺少密钥没测，第一版先用本地域名规则做分类。

## 核心概念

**RAG（检索增强生成）**：模型回答之前先去检索资料，把资料放进 Prompt，让回答有依据。本项目的 RAG 链路是：改写检索词 → 检索 → 重排 → 生成。M0 验证的是「检索」这一环能拿到什么数据。

**原文片段（raw content）**：搜索结果里的 `snippet` 只有一两百字，用来生成研报不够，用来定位高亮句子更不够。所以检索阶段就要把正文取回来。Tavily 传 `include_raw_content`，DeepSeek 搜索传 `need_content`。见 `backend/scripts/probe_tavily.py:30-33`、`backend/scripts/probe_deepseek_search.py:29`。

**分数口径**：重排公式是 `w_rel × relevance + w_auth × authority + w_fresh × freshness`。Tavily 的 `score` 在 0 到 1 之间，是纯相关性分。DeepSeek 的 `rerank_score` 在 0 到 3 之间，已经把权威性和时效性算进去了。如果直接当 relevance 用，权威性就被算了两次。两家分数必须先换算成同一种口径。见 `backend/docs/外部依赖实测.md:109`。

**Provider 适配层**：两家搜索的字段名、日期格式（RFC 1123 和 RFC 3339）、过滤方式（`exclude_domains` 参数和在 query 里拼 `-site:`）都不一样。M2 要写一个 `SearchProvider` 基类，把结果统一成内部的 `SourceCard` 结构，流水线后面的步骤就不用关心结果来自哪家。

**OpenAI 兼容接口**：很多模型厂商都实现了 OpenAI 的 `chat/completions` 格式，换厂商只需要改 `base_url`、`api_key`、`model` 三个值。`backend/app/config.py` 里的 `LLM_BASE_URL`、`LLM_MODEL` 就是为这个准备的。

**思考模式与首 token**：推理模型默认先思考，思考结束才输出正文，首 token 会明显延后。关闭思考要传 `"thinking": {"type": "disabled"}`，实测首 token 约 550ms。见 `backend/scripts/probe_deepseek_llm.py:52`。

**SSE（Server-Sent Events）**：服务器通过一个长连接，持续把事件推给浏览器。每条事件由 `event:`、`id:`、`data:` 几行组成，以一个空行结束。以冒号开头的行是注释，客户端会忽略。见 `frontend/scripts/sse-probe-server.mjs:52`。

**空闲超时与心跳**：Next.js 内置代理默认 30 秒内没有数据流过就断开上游（`node_modules/next/dist/server/lib/router-utils/proxy-request.js:37`）。浏览器那边已经收到 200，不会报错，界面就一直停在「检索中」。解决办法是后端定时发一行注释 `: ping`，它不影响业务数据，但能让连接保持活跃。见 `frontend/scripts/sse-probe-server.mjs:47`。

**证据分级**：A 级是拿到了真实响应，B 级是官方文档这么写，C 级是只确认了端点存在。只有 A 级的字段可以写进接口契约。

## 流程图

```text
用户问题
  │
  ▼
改写检索词 ──── LLM（DeepSeek deepseek-flash，关闭思考）
  │  3-5 个子检索词
  ▼
并发检索 ────── Tavily  /search             score 0-1、raw_content、published_date
  │             DeepSeek /v1/tools/search  rerank_score 0-3、content、date
  ▼
SearchProvider 统一成 SourceCard（去 URL 片段 #1、统一日期、统一分数口径）
  │
  ▼
过滤 → 分类（Jev 阻塞，用本地域名规则）→ 重排 → 取前 K 个
  │
  ▼
生成研报 ────── LLM 流式输出 token
  │
  ▼
SSE 推给浏览器：trace / sources / token / related / done，空闲时每 10 秒一行 ": ping"
```

## 关键代码走读

### 1. 读取模型的流式输出（`backend/scripts/probe_deepseek_llm.py:64-86`）

```python
with client.stream("POST", url, headers=headers, json=body) as r:
    status = r.status_code
    if status != 200:
        r.read()
        note = f"非 200 响应：{r.text[:500]}"
    else:
        for line in r.iter_lines():
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                chunks.append({"_raw": "[DONE]"})
                break
            obj = json.loads(data)
            chunks.append(obj)
            for ch in obj.get("choices") or []:
                delta = (ch.get("delta") or {}).get("content")
                if delta:
                    if first_token_ms is None:
                        first_token_ms = (time.perf_counter() - start) * 1000
                    text_parts.append(delta)
            if obj.get("usage"):
                usage = obj["usage"]
```

- `client.stream` 不会一次性读完响应体，数据到一行就处理一行，这是流式的前提。
- 非 200 时先 `r.read()` 再取 `r.text`。流式响应不读完拿不到正文，错误信息就丢了。
- 只处理以 `data:` 开头的行，空行和注释行跳过。`[DONE]` 是 OpenAI 格式的结束标记。
- 首 token 计时取的是第一个非空 `delta`。第一个 chunk 的 content 往往是空字符串，如果拿它计时，首 token 耗时会偏小。
- `usage` 在最后一个 JSON chunk 上，所以每个 chunk 都要检查一遍，不能只看第一个。

### 2. 在浏览器侧自己解析 SSE（`frontend/scripts/sse-probe-client.mjs:16-29`）

```js
const res = await fetch(url, { headers: { Accept: "text/event-stream" } });
// ...
const decoder = new TextDecoder();
for await (const chunk of res.body) {
  buffer += decoder.decode(chunk, { stream: true });
  let idx;
  while ((idx = buffer.indexOf("\n\n")) !== -1) {
    const block = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 2);
    const event = /^event: (.+)$/m.exec(block)?.[1];
    if (!event) continue;
    // ...
  }
}
```

- 浏览器自带的 `EventSource` 只能发 GET，也不能加请求头，也不能主动中止。本项目的检索请求是带参数的 POST，还要支持按 `Esc` 中止，所以改用 `fetch` 读 `ReadableStream`，自己解析。
- 网络分块的边界不等于事件边界，一个 chunk 里可能只有半条事件。所以先把数据攒进 `buffer`，遇到 `\n\n` 才切出一条完整事件。
- `decode(chunk, { stream: true })` 处理被切开的多字节字符。一个中文字符占 3 字节，可能正好被分在两个 chunk 里。
- 没有 `event:` 的块直接跳过。`: ping` 心跳就是这样被忽略的。
- 正式代码（M3）还要加一个 `AbortController`，用来中止请求，再加一个 45 秒空闲看门狗。

## 踩坑与取舍

| 问题 | 教程做法 | 本项目做法 |
| --- | --- | --- |
| OpenUI DSL 写法 | 缩进子行 + 命名参数 | 这种写法解析结果为空，而且不报错。改用 OpenUI Lang 原生语法（`root = X(...)`），写进 M1 契约 |
| Jev 字段名 | `choices` / `choice` / `probability` | 官方文档是 `criteria` / `probabilities`（B 级）；没有密钥，第一版用本地域名规则 |
| 思考模式 | 没提 | 必须显式关闭，否则「收到首个 token 就切屏」的设计会失效 |
| Tavily 发布时间 | 没传 `include_published_date` | 必须传。不传时这个字段根本不出现，时效分会全部缺失 |
| 预印本过滤 | 只按 `exclude_domains` 排除 arxiv.org | 挡不住 alphaxiv.org、ar5iv.labs.arxiv.org 这类镜像，第 3 层的域名规则要把镜像站也列进去 |
| 相关性兜底 | 缺失时填固定值 0.8 | 不填假值，标记缺失，把它的权重按比例分给其他项 |
| 耗时统计 | 截图里的数字 | Tavily 返回的 `response_time` 恒为 0.0，耗时一律由后端用 `perf_counter` 自己计时 |
| 密钥 | 没提 | 本轮出现过一次 key 被填进 `.env.example`，及时挪到了 `.env`。`.env.example` 被 git 跟踪，只能放空模板 |

## 延伸阅读

- MDN · Using server-sent events：https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
- WHATWG HTML 规范 · Server-sent events：https://html.spec.whatwg.org/multipage/server-sent-events.html
- DeepSeek API 文档：https://api-docs.deepseek.com/
- Tavily 文档：https://docs.tavily.com/

## 自测题

**1. 为什么本项目不用浏览器自带的 `EventSource`？**

<details>
<summary>答案</summary>

`EventSource` 只能发 GET，不能自定义请求头，也不能主动中止。检索请求是带参数的 POST，还需要按 `Esc` 中止，所以用 `fetch` 加 `ReadableStream` 自己解析，再配一个 `AbortController`。

</details>

**2. 检索阶段最长有 40 秒没有任何事件，用户会看到什么？怎么解决？**

<details>
<summary>答案</summary>

Next.js 代理默认 30 秒空闲就断开上游，而浏览器已经收到 200，不会报错，界面会一直停在「检索中」。解决办法有两层：后端每 10 秒发一行 `: ping` 注释，让连接保持活跃；前端设一个 45 秒空闲看门狗，超时就进入错误态。

</details>

**3. 把 DeepSeek 搜索的 `rerank_score` 直接当 `relevance` 代入重排公式，会出什么问题？**

<details>
<summary>答案</summary>

`rerank_score` 已经混合了相关性、权威性和时效性，再乘 `w_rel` 并加上 `w_auth × authority`，权威性和时效性会被重复计算，DeepSeek 来源的结果会系统性地排得偏前。它的取值范围是 0 到 3，Tavily 是 0 到 1，量纲也不一样。必须先在 Provider 层统一口径。

</details>
