# M1 学习笔记：RAG 链路设计与契约先行

> 日期：2026-11-06 · 对应里程碑：M1 接口与数据库设计定稿
> 定稿契约：`docs/接口设计.md`、`docs/数据库设计.md`；草案素材：`backend/docs/接口设计-草案.md`、`frontend/docs/OpenUI组件签名-草案.md`

## 这一阶段做了什么

M0 把每个外部依赖单独测通了，M1 把它们连成一条完整的检索链路，并用文字契约固定下来：一次检索分四个阶段（改写 → 检索 → 分类重排 → 生成），每阶段发什么 SSE 事件、每个信源长什么样、分数怎么算、引用怎么定位、历史怎么存，全部写进了 `docs/接口设计.md`。同时定了数据库表和迁移方案。M2 开始，前后端就照这份契约写代码，互不等待。

## 核心概念

**查询改写**：用户的问题往往不适合直接搜。改写是让 LLM 把一个问题拆成 3–5 个子检索词，分别去搜，覆盖面更大。改写失败时降级为「用原问题直接搜」，流程不中断。见 `docs/接口设计.md` §3.1 的 `detail.fallback`。

**RAG 上下文拼装**：生成研报时不能把几十个信源全文塞给模型，要控制预算。取前 K 个信源，每个只给清洗后的原文片段（≤1500 字符），拼成 Prompt。`passage` 就是这个片段。见 `docs/接口设计.md` §4.4。

**多目标重排**：`final = w_rel × relevance + w_auth × authority + w_fresh × freshness`。三项权重随检索模式变化：academic 最看重权威度（0.5），web 最看重相关性（0.5）。缺失项把权重按比例分给其他项，而不是填假值。见 `docs/接口设计.md` §5。

**分数口径陷阱**：Tavily 的分数是 0–1 的纯相关性，DeepSeek 的 `rerank_score` 是 0–3 的混合分（相关性加权威性加时效性都算在里了）。直接混用等于把权威性算两次。定稿做法：DeepSeek 的相关性取 `rerank_score / 3`，且权重固定为只看相关性。见 `docs/接口设计.md` §5.3。

**Grounding（证据定位）**：正文里写 `[3]`，后端在 `done` 事件里下发这处引用在正文中的位置，以及被引用句子在原文片段中的位置。前端点角标就滚到对应句子。偏移按 UTF-16 码元计，因为 JS 的 `slice` 就是按这个算的。见 `docs/接口设计.md` §7.2。

**共识度实算**：教程里这个数字是写死的字符串。本项目改为可复算的计数：被两个以上不同域名信源支持的引用句数，除以带引用的句子总数。没有带引用的句子时不计算，界面不显示。见 `docs/接口设计.md` §7.3。

**生成式 UI 与 DSL**：评测数据不用 Markdown 表格也不用 JSON，而是让模型输出一种行式 DSL（`root = X(...)`），每写完一行就能渲染一行。参数是位置参数，前端后端必须按同一顺序，否则数据错位还不报错。见 `frontend/docs/OpenUI组件签名-草案.md` §2。

**契约先行**：前后端先把接口字段写死，再各自开工。前端按契约 mock，后端按契约实现。契约里的每个字段都要有依据：PRD、实测数据，或明确标「未确认」。

## 流程图

```text
POST /api/search/stream {query, focusMode, engine, scopeFilters}
  │
  ├─ 校验失败 → 400 {code, msg}
  │
  ├─ 命中 L2 缓存？→ 是：回放整套事件（cacheHit=true，本次真实耗时）
  │
  ├─ 1. rewriting（LLM，3–5 个子检索词）      → trace start/end
  ├─ 2. searching（并发检索，降级切引擎）      → trace + sources raw（逐批）
  ├─ 3. reasoning（去重→过滤→分类→重排→取K）   → trace + sources ranked（一次）
  ├─ 4. generating（LLM 流式）                 → trace + token（多条）
  │     中途接到客户端断开 → 退出，不再调外部 API
  │
  └─ 收尾：引用解析→高亮定位→要点/追问→写库    → related?, done
      任一步失败 → error 事件 → 关闭连接，不发 done
```

## 关键代码走读

M1 没有业务代码，走读的是两段「设计即代码」：URL 归一化规则和分数合成规则，都能用 `backend/docs/m1/compute_examples.py` 从真实探测数据重算。

### 1. 稳定 id：`id = "src_" + sha256(归一化 URL)[:12]`

两家引擎返回的 id 都不稳定（Tavily 同一 URL 两次请求给出不同 id），不能用来去重。归一化步骤：scheme 和 host 小写、去掉 `www.`、去掉 `#` 片段、去掉 `utm_` 参数。归一化**只用于算 id 和去重**，展示的 `url` 保持原样。

M0 实测 DeepSeek 返回过 `...#1`、`...#1#1#1` 这类带片段的 URL（见 `docs/接口设计.md` §4.2）。不去片段，同一页面会被拆成多条。

### 2. 分数合成（`docs/接口设计.md` §5.2）

```text
final = w_rel * relevance + w_auth * authority + w_fresh * freshness
```

缺 `publishedAt` 时 `freshness = null`，它的权重按其余权重比例分摊，实际权重记在 `scores.weights` 里，前端能区分「没算」和「算出来低」。示例值（从真实探测数据重算）：relevance 0.8286、authority 0.7、freshness 0.4369、final 0.7248。

## 踩坑与取舍

| 问题 | 做法 |
| --- | --- |
| 草案改写是 1–3 个子查询，与 PRD 的 3–5 矛盾 | 定稿 3–5，按 PRD |
| 草案两处超时数值互相矛盾（改写 10s/15s） | 统一按 PRD §9.2：改写 15s、单次搜索 10s、分类 2.5s |
| 草案 §13 把历史路径写成 `/api/search/history*`，和自己 §1 表格的 `/api/history*` 矛盾 | 定稿 `/api/history*`，与 PRD §8.2 一致 |
| `suggestions` 在表格里出现但正文没有规范 | 补上 §13.6：P0 用后端内置列表 |
| 两份草案的 `trace.status` 枚举不一致（`start/end/degraded` 对 `start/ok/fail/skip`） | 定稿 `start/end/degraded`，与事件顺序一致 |
| `cache_hit` 口径：标首算行还是回放插新行 | 定稿插新行。回放是新的一次用户检索（有新的耗时），插行才能如实记录；且每条历史要能独立恢复 |
| DeepSeek 的分数口径 | `rerank_score / 3` 当相关性，权重只看相关性，避免 authority 重复计算 |
| OpenUI 签名 D1–D7 | 按前端推荐全部采纳：不设包装根、可选参数只从末尾省略、流结束 `unresolved` 非空但无 errors 照样渲染、`Row.cells` 用对象、数量上限只作提示、`duration` 用 number、组件名英文 |

## 延伸阅读

- Tavily 搜索 API 参考：https://docs.tavily.com/documentation/api-reference/endpoint/search
- DeepSeek API 文档（chat completion 与 reasoning 模式）：https://api-docs..com/
- OpenUI Lang 语法：https://github.com/thesysdev/openui（`packages/react-lang` 的 README）
- SQLite 外键与事务：https://www.sqlite.org/lang_transaction.html

## 自测题

**1. 为什么 `rerank_score` 不能直接当 `relevance` 代入重排公式？**

<details>
<summary>答案</summary>

`rerank_score`（0–3）已经混合了相关性、权威性和时效性，而 Tavily 的 `score` 是 0–1 的纯相关性。直接混用等于把权威性和时效性算两次，DeepSeek 的结果会系统性偏高。定稿做法是 `relevance = rerank_score / 3`，且 DeepSeek 侧的权重固定为只看相关性。量纲也不同：不归一化就没法比较。

</details>

**2. 为什么引用和高亮的偏移要用 UTF-16 码元，而不是字符数？**

<details>
<summary>答案</summary>

因为前端用 JS 的 `slice` 切字符串，而 JS 字符串按 UTF-16 码元索引。中文在 UTF-16 里一般是 1 个码元，但在 Python 的 `len()` 里是 1 个字符；emoji 在 UTF-16 里是 2 个码元。用码点计会和前端切出来的位置对不上。后端算偏移时必须按 UTF-16 码元。

</details>

**3. 缓存回放时，为什么 `trace` 里不能下发缓存中存的历史耗时？**

<details>
<summary>答案</summary>

因为那是上次检索的耗时，不是这次的。回放只是毫秒级的文件读取，如果界面显示「耗时 8 秒」，就是在编造数字（违反 D4）。正确做法：回放走同一套事件序列，但耗时是本次回放的真实耗时，并带 `cacheHit: true` 告诉前端这是缓存。

</details>
