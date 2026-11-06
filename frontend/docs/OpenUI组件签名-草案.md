# OpenUI 组件签名草案（M1）

> 日期：2026-11-06 · 起草：前端 session · 状态：草案，待主调度定稿后写入 `docs/接口设计.md`
> 依据：`@openuidev/react-lang@1.1.0` 实测（M0 结论见 `依赖核实.md` §1.1）
> 复现脚本：`scripts/openui-probe/`（依赖装在项目外临时目录，不进 `package.json`）

签名是跨端契约：前端用它定义组件库并渲染，后端把它写进生成研报的 System Prompt。任何一边改了参数顺序，另一边就会解析出错位的数据。

---

## 1. 语法要点（OpenUI Lang 原生语法）

- 每行一条语句：`标识符 = 表达式`，第一行必须是 `root = <卡片>(...)`。
- 参数是**位置参数**，顺序就是下表的顺序。不支持 `key=value`、`key: value` 写法。
- 可选参数只能从末尾省略。
- 子组件用名字引用（`[c1, c2]`），引用可以先用后定义。
- 字符串用双引号，内部引号写 `\"`。
- 研报里每张卡片单独放一个 fence 块，语言标记 `openui-lang`（原因见 §5）。

## 2. 组件签名

### 2.1 HardwareBenchmarkCard：硬件基准对比卡片

| 位置 | 参数 | zod 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| 1 | `title` | `z.string()` | 是 | 卡片标题，可带 `[n]` |
| 2 | `columns` | `z.array(Column.ref)` | 是 | 列定义，2 到 6 列 |
| 3 | `rows` | `z.array(Row.ref)` | 是 | 数据行，1 到 12 行 |
| 4 | `note` | `z.string().optional()` | 否 | 表下注释，如测试条件，可带 `[n]` |

**Column**

| 位置 | 参数 | zod 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| 1 | `key` | `z.string()` | 是 | 列键，只用小写字母、数字、下划线 |
| 2 | `label` | `z.string()` | 是 | 列标题 |
| 3 | `sortable` | `z.boolean().optional()` | 否 | 是否可排序，默认 false |
| 4 | `highlight` | `z.boolean().optional()` | 否 | 是否重点列，默认 false；一张卡片最多一列 |

**Row**

| 位置 | 参数 | zod 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| 1 | `cells` | `z.record(z.string(), z.string())` | 是 | 列键到单元格文字的映射，值一律写字符串，可带 `[n]` |

### 2.2 PipelineClockCard：执行流水线时钟卡片

| 位置 | 参数 | zod 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| 1 | `title` | `z.string()` | 是 | 卡片标题，可带 `[n]` |
| 2 | `unit` | `z.enum(["cycles", "ns", "us", "ms"])` | 是 | 所有阶段共用的耗时单位 |
| 3 | `stages` | `z.array(Stage.ref)` | 是 | 按执行顺序，2 到 8 个 |

**Stage**

| 位置 | 参数 | zod 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| 1 | `name` | `z.string()` | 是 | 阶段名，如「TMA 异步加载」 |
| 2 | `duration` | `z.number()` | 是 | 耗时，单位由卡片 `unit` 决定，大于等于 0 |
| 3 | `detail` | `z.string()` | 是 | 点击展开后的时延说明，可带 `[n]` |

`library.prompt()` 生成的签名行（后端可直接用）：

```text
HardwareBenchmarkCard(title: string, columns: Column[], rows: Row[], note?: string)
Column(key: string, label: string, sortable?: boolean, highlight?: boolean)
Row(cells: Record<string, string>)
PipelineClockCard(title: string, unit: "cycles" | "ns" | "us" | "ms", stages: Stage[])
Stage(name: string, duration: number, detail: string)
```

## 3. 完整示例（实测可解析）

示例里的数字只用来演示签名，不是业务数据。

```text
root = HardwareBenchmarkCard("FlashAttention-3 与 FlashAttention-2 吞吐对比 [1]", [c1, c2, c3, c4], [r1, r2, r3], "H100 SXM5，序列长度 8K [2]")
c1 = Column("kernel", "内核", false, false)
c2 = Column("precision", "精度", false, false)
c3 = Column("tflops", "吞吐 (TFLOPS)", true, true)
c4 = Column("gain", "相比 FA2", true, false)
r1 = Row({kernel: "FlashAttention-2", precision: "FP16", tflops: "350", gain: "1.0x"})
r2 = Row({kernel: "FlashAttention-3", precision: "FP16", tflops: "740 [1]", gain: "2.1x [1]"})
r3 = Row({kernel: "FlashAttention-3", precision: "FP8", tflops: "1200 [2]", gain: "3.4x [2]"})
```

```text
root = PipelineClockCard("Hopper GEMM 单个 tile 的流水线 [3]", "ns", [s1, s2, s3])
s1 = Stage("TMA 异步加载", 120, "从 HBM 搬运 A、B tile 到共享内存，与上一 tile 的计算重叠 [3]")
s2 = Stage("Tensor Core 计算", 340, "WGMMA 指令执行矩阵乘累加 [3]")
s3 = Stage("SMEM 写回", 60, "累加结果经共享内存写回全局内存 [4]")
```

实测结果（`OPENUI_PROBE_DIR="$TEMP/openui-m1" node scripts/openui-probe/probe.mjs parse`，安装命令见 `probe.mjs` 文件头）：

```text
== benchmark 完整示例
meta: {"incomplete":false,"unresolved":[],"orphaned":[],"statementCount":8}
errors: []
== clock 完整示例
meta: {"incomplete":false,"unresolved":[],"orphaned":[],"statementCount":4}
errors: []
```

不指定 `root` 的组件库同时解析两种卡片，结果相同，`errors: []`。

## 4. 流式截断示例

把基准卡片截断在第 4 行 `c3 = Column("tfl` 处，交给 `createStreamingParser`：

```text
root = HardwareBenchmarkCard("FlashAttention-3 与 FlashAttention-2 吞吐对比 [1]", [c1, c2, c3, c4], [r1, r2, r3], "H100 SXM5，序列长度 8K [2]")
c1 = Column("kernel", "内核", false, false)
c2 = Column("precision", "精度", false, false)
c3 = Column("tfl
```

预期并实测的结果：

```text
root: HardwareBenchmarkCard (partial)，title、note 已就位，columns 只有 c1、c2，rows 为空
meta: {"incomplete":true,"unresolved":["c4","r1","r2","r3"],"orphaned":[],"statementCount":4}
errors: ["missing-required c3 /label ..."]
```

- 写到一半的 `c3` 缺必填参数，被丢弃并记进 `errors`，**不抛异常**。
- 还没出现的 `c4`、`r1`–`r3` 进 `unresolved`，渲染时当作不存在。
- 补齐全文并标记结束后：`incomplete: false`，`errors: []`。
- 逐字符 push 589 个字符：第 96 个字符时 root 首次出现（卡片外壳先显示），全程抛异常 0 次。

结论：流式过程中 `errors` 非空是正常的，**只能在流结束后**用 `errors` 判断是否降级。

## 5. 边界情况实测

| 输入 | 结果 | 前端处理 |
| --- | --- | --- |
| 教程写法（缩进子行 + 命名参数） | `root: null`，`errors: []` | 降级为源码视图 |
| 省略可选参数 | 正常解析 | 按默认值 false 渲染 |
| Row 里有未定义的列键 | 不报错，键原样保留 | 只渲染已定义的列，多余键忽略 |
| 单元格写成数字 `350` | **不报错**，值是 number | 渲染前统一 `String()` |
| 引用了未定义的行 `r2` | `unresolved: ["r2"]`，`errors: []`，r2 被丢弃 | 见 §8 第 3 条 |
| 字符串里有 `\"` | 正常解析为 `"` | 无需处理 |
| `unit` 不在枚举内 | `root: null`，报 `type-mismatch` | 降级为源码视图 |
| `duration` 写成字符串 `"120"` | 该 Stage 被丢弃，`stages: []`，报 `type-mismatch` | 降级为源码视图 |
| 一段 Markdown 里有两个 fence 块 | parser 把所有块拼成一个程序，后一个 `root` 覆盖前一个，**只剩第二张卡片且不报错** | 每个 fence 块单独解析 |

最后一条决定了研报里的写法：每张卡片一个独立 fence 块，前端在 `react-markdown` 的 `code` 组件里识别 `language-openui-lang`，对每个块单独调用 parser。

## 6. `[n]` 引用角标

- **DSL 里的表示**：就是字符串里的普通文字 `[n]`，n 为信源编号，从 1 开始，和研报正文角标同一套编号。不加转义，不用特殊语法。parser 原样保留（实测 `"740 [1]"` 解析后仍是 `"740 [1]"`）。
- **允许出现的位置**：`title`、`note`、Row 的单元格、Stage 的 `detail`。`Column.label`、`Stage.name`、`key` 里不出现。
- **前端识别**：渲染这些字段时用正则 `/\[(\d+)\]/g` 切分文本，数字落在当前信源编号范围内的渲染为角标按钮，超出范围的按纯文本显示（和 F05 规则一致）。
- **排序**：可排序列按单元格开头的数字排序（先去掉 `[n]`，再取 `parseFloat`）。开头不是数字的单元格排在最后。

## 7. `library.prompt()` 输出与使用建议

完整输出见 `scripts/openui-probe/prompt-output.txt`（4709 字符）。`node scripts/openui-probe/probe.mjs prompt` 可以重新生成。

实测发现三个问题，**不建议后端整段照搬**：

1. **根组件名写错**：组件库不指定 `root` 时，提示词写的是 `root = Root(...)`，但库里没有 `Root` 组件；指定 `root: "HardwareBenchmarkCard"` 后提示词就只提这一种卡片。两种卡片都要用时，库生成的提示词都不对。
2. **默认开场白和研报冲突**：默认开场白是「整个回复都必须是 openui-lang，不要 Markdown」。实测传入 `preamble` 可以整段替换掉它。
3. **inline 模式是聊天场景写的**：其中「用户提问时只回文字、不输出代码」「只输出改动的语句」这类规则不适合研报生成。

建议后端只取两段放进 System Prompt：

- §2 末尾的签名行；
- 下面这段规则（从生成的提示词里删改而来）：

```text
评测数据用 openui-lang 代码块输出，每张卡片一个 ```openui-lang 代码块：
1. 每行一条语句：identifier = Expression
2. 第一行必须是 root = HardwareBenchmarkCard(...) 或 root = PipelineClockCard(...)
3. 参数是位置参数，按签名顺序书写；不支持 key=value 或 key: value
4. 可选参数只能从末尾省略
5. 除 root 外，每个定义的名字都必须被引用，否则会被丢弃
6. 字符串用双引号，内部引号写 \"；Row 的单元格值一律写字符串
7. 引用信源时在字符串里写 [n]，n 是信源编号
```

## 8. 需要主调度决定

| 编号 | 问题 | 选项 | 前端推荐 |
| --- | --- | --- | --- |
| D1 | 两种卡片怎么组织根组件 | A. 组件库不设 `root`，每个 fence 块以哪种卡片开头就渲染哪种；B. 加一个包装根组件 `CardGroup([...])` | **A**。实测不设 root 也能解析两种卡片，包装组件会多一层签名，模型更容易写错 |
| D2 | System Prompt 用不用 `library.prompt()` 的整段输出 | A. 整段用；B. 只用签名行 + §7 的规则 | **B**，原因见 §7 |
| D3 | 流结束后有 `unresolved`（引用了没定义的行或阶段）但 `errors` 为空 | A. 照样渲染已有部分；B. 降级为源码视图 | **A**，在卡片底部用 `--ink-muted` 标一句「部分数据未生成」。`root` 为空或 `errors` 非空时才降级 |
| D4 | `Row.cells` 用对象还是位置数组 | A. 对象 `{kernel: "..."}`；B. 位置数组 `["...", "..."]`，顺序同列定义 | **A**。对象和列键对得上，模型漏一列不会导致整行错位；代价是 token 多一点 |
| D5 | 数量上限（列 2–6、行 1–12、阶段 2–8）是硬校验还是提示 | A. 只写在描述里提示模型；B. 前端超限时截断 | **A**，超限时照常渲染，表格横向滚动 |
| D6 | `duration` 用 number 还是字符串 | A. number，前端可画水平条；B. 字符串，模型更自由 | **A**。时钟卡片要按耗时画比例条，必须是数字 |
| D7 | 组件名用英文还是中文 | 英文；中文只出现在字符串参数里 | 英文。组件名是代码标识符 |
