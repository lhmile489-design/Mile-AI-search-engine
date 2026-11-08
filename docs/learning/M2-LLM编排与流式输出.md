# M2 学习笔记：LLM 编排与流式输出

> 日期：2026-11-08 · 对应里程碑：M2 后端最小闭环（后端提交 `b0eed68`）
> 契约：`docs/接口设计.md` §2–§3、§7、§10

## 这一阶段做了什么

M1 的契约在 M2 变成了真实代码：`POST /api/search/stream` 接收问题，依次完成改写、并发检索、重排、流式生成、收尾（引用解析、高亮、要点、共识度、写库），每一步通过 SSE 推给前端。整条流水线是一个 Python 异步生成器，`yield` 一次就是推一帧。87 个单测通过，端到端冒烟拿到了正确的事件顺序、非零的引用偏移和落库的历史记录。

## 核心概念

**编排（Orchestration）**：把「改写、检索、重排、生成」这些独立步骤按顺序串起来，决定每步的超时、失败后怎么降级、哪些结果要传给下一步。本项目的编排是一段顺序代码，没有用框架：`backend/app/pipeline/stream.py:134` 的 `run_pipeline`。

**异步生成器驱动 SSE**：函数里每次 `yield` 一个帧字符串，FastAPI 就把它写进响应流。生成器没往前走，连接上就没有数据。这个模型让「每个阶段结束就推一个事件」非常自然，见 `stream.py:235`（`rewriting start`）到 `stream.py:582`（`done`）。

**并发与完成顺序**：3–5 个子检索词同时检索，哪个先回来就先推哪个。`asyncio.as_completed` 按完成先后给出结果，`sources raw` 事件因此是「逐批」到达的，见 `stream.py:323`。

**降级（Degradation）**：主引擎失败就切备用引擎，改写失败就用原问题，收尾失败就不发 `related`。原则是失败不让整条流水线死掉，见 `stream.py:300–319`（引擎切换）和契约 §3.1 的 `degraded` 状态。

**首 token 超时**：生成阶段不能无限等。`generator.py:98` 把读超时设为 30 秒；一个 token 都没收到则判为失败，见 `generator.py:143`。

**收尾与 Grounding**：正文生成完后，后端对完整文本解析 `[n]`（`stream.py:509`），算出每处引用的位置和被引句子在原文里的位置，再统一在 `done` 事件里下发。流式过程中后端不知道最终文本，所以这些数据只能放在最后。

## 流程图

```text
POST /api/search/stream
  │  校验失败 -> HTTP 400（不建流）
  ▼
[ 检查断开 ] -> 改写(LLM, 15s) -> trace
[ 检查断开 ] -> 并发检索 N 个子检索词
                 ├─ 先完成的先推 sources raw
                 └─ 主引擎失败 -> 备用引擎 -> trace degraded
全部失败 -> error(50201) -> 关流
[ 检查断开 ] -> 去重/过滤/分类/重排 -> sources ranked
[ 检查断开 ] -> 流式生成 -> token x N（每个 chunk 后检查断开）
收尾: parse_citations -> compute_consensus -> finalize(LLM) -> related
      -> 写库 -> done
任意未捕获异常 -> error(50001)；finally 里取消心跳任务
```

## 关键代码走读

### 1. 为什么 `yield` 就是推送（`stream.py:454–470`）

```python
async for chunk in generate_report(...):
    if await is_disconnected():
        return
    if chunk["type"] == "token":
        report_parts.append(chunk["delta"])
        yield await emit("token", {"delta": chunk["delta"]})
    elif chunk["type"] == "error":
        yield await emit("error", _error_payload(code, str(exc)[:200], "generating", True, "llm"))
        return
```

- `generate_report` 本身也是异步生成器，每收到一个 LLM chunk 就吐一个字典，`run_pipeline` 再把它转成 SSE 帧：生成器套生成器，背压自然传导。
- 每个 chunk 之后检查客户端是否断开，这是设计里的「检查点」。
- 错误不抛异常，而是作为一种 chunk 类型返回，上层统一转成 `error` 事件，已经发出的 `token` 不撤回。
- `str(exc)[:200]` 截断错误信息，避免把上游原始报文原样给用户。

### 2. 并发检索加降级（`stream.py:286–329`）

`search_one` 先试主引擎，失败则试备用，都失败返回空列表和 `"none"`。外层 `as_completed` 只关心「谁先到」，空结果记入 `failed_queries` 而不中断。两层 `try` 对应两层降级，每层都有 `asyncio.wait_for` 超时。

### 3. 偏移单位（`finalizer.py:31`）

Python 字符串按码点计数，JS 按 UTF-16 码元计数。含 emoji 等字符时两者不同，所以后端下发偏移前要换算，前端才能直接 `slice`。

## 踩坑与取舍

| 问题 | 说明 |
| --- | --- |
| 中止的真相 | 客户端断开后，服务器不是在检查点退出，而是连接一关，在飞的请求立刻失败。结果上没有再调外部 API，但「客户端已断开（检索中）」这行日志从不触发（`stream.py:325`）。检查点形同虚设，M4 修 |
| 失败日志为空 | 连接关闭时抛出的异常字符串为空，日志只有「失败: 」。应该记 `type(exc).__name__` 加 `repr(exc)`，M4 修 |
| 心跳只做了一半 | 契约要求每 10 秒发 `: ping`（`stream.py:167–172`），但只有往队列里放的一端，没有任何地方取出来 yield。当前流里没有心跳。正常一次检索事件够密，没暴露；但改写加检索最坏可静默超过 30 秒，会撞上 Next 代理的空闲超时。M4 必须接上 |
| 句子切分切开小数 | `finalizer.py:28` 的句末正则把 `1.3` 切成 `1.` 和 `3`，导致高亮起点偏后。M4 修 |
| 教程做法对比 | 教程里共识度是固定字符串，这里按 `被引 >=2 个不同域名的句子 / 带引用的句子` 实算 |

## 延伸阅读

- FastAPI 流式响应：https://fastapi.tiangolo.com/advanced/custom-response/#streamingresponse
- MDN：Server-sent events 的帧格式与注释行：https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
- Python asyncio 任务与 `as_completed`：https://docs.python.org/3/library/asyncio-task.html
- httpx 异步客户端与超时：https://www.python-httpx.org/async/

## 自测题

**1. 异步生成器里怎么做到「每个阶段结束就推一个事件」？**

<details>
<summary>答案</summary>

生成器每次 `yield` 一个 SSE 帧字符串，FastAPI 把它写入响应流并刷出，然后控制权回到生成器继续往下执行。没有 `yield` 就没有数据，所以阶段结束的位置放一个 `yield` 就是一次推送。

</details>

**2. 为什么 `citations` 和 `highlight` 只能放在 `done` 事件里？**

<details>
<summary>答案</summary>

引用位置依赖完整的研报文本：`[n]` 在正文中的偏移、被引句子的边界、句子在原文片段里的匹配位置，都要等文本生成完才能算。流式过程中后端只有已发出的前缀，所以统一在收尾阶段计算，随 `done` 下发。

</details>

**3. 心跳任务往队列里放了 `: ping`，为什么实际上没有发出去？这会造成什么后果？**

<details>
<summary>答案</summary>

因为没有代码从队列里取出并 `yield`；生成器只有 `yield` 的内容才会被推送。后果是长时间无业务事件时（改写加检索最坏超过 30 秒），Next 内部代理会因空闲超时断开上游，浏览器侧拿不到明确错误。前端 45 秒看门狗只是兜底，不能代替后端心跳。

</details>
