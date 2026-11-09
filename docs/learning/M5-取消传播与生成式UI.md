# M5 学习笔记：取消传播、BibTeX 与生成式 UI

## 这一阶段做了什么

M5 补齐了教程里剩下的功能：检索模式切换（F15）、范围过滤（F21）、引擎切换（F22）、核心要点（F23）、推理摘要（F24）、共识度（F25）、观测台（F12）、相关追问（F14）、BibTeX 复制（F13）和 OpenUI 交互卡片（F11）。同时后端把 M4 遗留的"客户端断开日志不出现"查清并修好，把 1000 多行的 `stream.py` 拆成四个模块。验收时主调度在真实环境发现 F11 的卡片没有渲染，根因是后端提示词和前端组件库的名字对不上，前端补注册后修复。

## 核心概念

**取消传播**：客户端断开后，要让后台正在跑的任务真正停下，而不是跑完再丢弃结果。本项目靠三件事：有界队列、断开监视器、先记日志再等待。对应 `backend/app/pipeline/stream.py:67`（队列 `maxsize=32`）、`stream.py:83-96`（`_disconnect_watcher`）、`backend/app/pipeline/_pipeline.py:576-596`（取消处理）。

**背压（backpressure）**：生产者比消费者快时，用有界队列让生产者在 `put` 处阻塞。无界队列下，消费者走了，流水线仍会一路跑完，`cancel()` 没有可以打断的 `await`。

**可复算的共识度**：不存固定文案，只数句子。`supported / cited`，`cited = 0` 时不下发。见 `backend/app/pipeline/finalizer.py:272-306`。

**缺字段就置空**：BibTeX 必需字段是标题、年份、以及 arXiv ID 或 DOI，缺任一返回 `None`，前端据此停用按钮。见 `backend/app/pipeline/bibtex.py:92-137`。

**生成式 UI**：模型输出行式 DSL，前端解析并渲染成组件。组件名是后端提示词和前端组件库之间的隐性契约。见 `frontend/src/lib/openui.ts:65-81`。

## 流程图

```text
客户端断开
   |
   v
_disconnect_watcher (每 0.5s 轮询 is_disconnected)
   |  检测到断开 -> task.cancel()
   v
_pipeline_task 在某个 await 处收到 CancelledError
   |  1. cancel 所有在飞的检索子任务
   |  2. 先写日志 "客户端已断开，阶段=..."
   |  3. 再 gather 等它们退出（可能被第二次取消打断，所以放在日志之后）
   v
raise -> finally 清理队列

有界队列的作用：
消费者停 -> queue.put 阻塞 -> cancel 能在这里打断
```

## 关键代码走读

**1. 日志必须在 `await` 之前（`_pipeline.py:576-596`）**

```python
except asyncio.CancelledError:
    task_cancelled = True
    cancelled = sum(1 for t in search_tasks if t.cancel())
    _abort_msg = f"[{request_id}] 客户端已断开，阶段={current_phase}，已取消 {cancelled} 个在飞任务"
    logger.warning(_abort_msg)
    ...
    if search_tasks:
        try:
            await asyncio.gather(*search_tasks, return_exceptions=True)
        except asyncio.CancelledError:
            pass
    raise
```

后端汇报说根因有三层，最隐蔽的是第三层：监视器取消一次，`run_pipeline` 的 `finally` 又取消一次，第二次 `CancelledError` 落在 `await gather()` 上，直接跳出整个 `except`，日志那一行没机会执行。所以日志挪到 `await` 之前，`gather` 自己再包一层 `except`。`raise` 保留是为了让任务以取消状态结束。

**2. 共识度只数句子（`finalizer.py:289-304`）**

```python
sent_domains: dict[int, set[str]] = {}
for cit in citations:
    ...
    sent_domains.setdefault(ss, set()).add(src.domain)

cited_sentences = len(sent_domains)
if cited_sentences == 0:
    return None
supported_sentences = sum(1 for d in sent_domains.values() if len(d) >= 2)
score = supported_sentences / cited_sentences
```

用句子起点作键，把同一句里引用的域名收成集合。集合大小 >= 2 才算多源支持。主调度在真实检索上手算了三组，和下发值一致：0/16、5/20、17/31。第一组分数是 0.0，这是真实结果，界面要显示 0%，不能当成"算不出"而隐藏。

**3. 组件名对不上（`openui.ts:65-81`）**

后端 `generator.py:30-36` 的提示词让模型写 `root = Table(...)`，前端草案里只有 `HardwareBenchmarkCard`。解析时 `Table` 命中 `unknown-component`，`root` 为空，页面静默降级成源码或普通表格。补注册 `Table` 并复用同一个渲染视图后修复。

## 踩坑与取舍

- **单测通过，真实路径失败**：中止日志的单测用假 provider，没有 Starlette 的取消时序，也没有双重取消。这类并发问题只能在真实服务上复现。
- **验收脚本恒 PASS**：`m5-e2e` 的 F11 在"后端没下发围栏"时也记 PASS，掩盖了名字漂移。改成没有可解析围栏就 FAIL。
- **脚本固定问题撞上缓存**："生成中 Esc"用固定问题，缓存命中后 41 ms 回放结束，没有可中止的东西，断言必然失败。改为带时间戳的新问题。
- **取舍**：提示词里的 `Table` 与草案里的 `HardwareBenchmarkCard` 两种写法前端都支持，没有统一。统一要改提示词，需要重新验证模型输出，收益只是以后加卡片更整齐，所以保留。

## 延伸阅读

- OpenUI 仓库：https://github.com/thesysdev/openui
- Python asyncio 任务与取消：https://docs.python.org/3/library/asyncio-task.html
- Python asyncio 队列：https://docs.python.org/3/library/asyncio-queue.html

## 自测题

1. 把 `asyncio.Queue(maxsize=32)` 改回无界队列，客户端断开后会发生什么？

<details><summary>答案</summary>

消费者停止后，流水线的 `put` 不会阻塞，任务会一路跑完，`cancel()` 找不到可以打断的 `await`。外部 API 仍被调用，中止日志也不出现。

</details>

2. 共识度 `score` 是 0.0 和 `null` 有什么区别？

<details><summary>答案</summary>

0.0 表示有被引用的句子，但没有一句引用两个以上不同域名。`null` 表示没有任何带引用的句子，无法计算。前者要显示 0%，后者不显示。

</details>

3. 为什么 `except asyncio.CancelledError` 里要先写日志、再 `await gather()`？

<details><summary>答案</summary>

任务可能被取消两次。第二次取消会在 `await` 处抛出 `CancelledError`，跳出整个处理块。日志放在 `await` 之前，才一定会执行。

</details>
