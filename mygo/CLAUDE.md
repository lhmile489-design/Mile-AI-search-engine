# CLAUDE.md — mygo session

> 启动目录：`mygo/`。上级规范见 `../CLAUDE.md`，冲突时以上级为准。
> 优先级：用户当次指令 > 本文件 > `../CLAUDE.md` > `DESIGN.md` / `PRODUCT.md` / `../docs/mygo迁移-PRD.md` > 全局 `~/.claude/CLAUDE.md`。
> 版本：v1.0 · 2026-11-09

## 1. 项目是什么

把 Mile AI Search 迁移为 mygo 桌面应用：后端全部用 Go 重写，前端用 React + Vite 跑在 WebView2，一个原生 exe 加安装器。功能范围、架构、里程碑、决策记录在 `../docs/mygo迁移-PRD.md`（v1.0），先通读。

| 文档 | 管什么 |
| --- | --- |
| `../docs/mygo迁移-PRD.md` | 范围、架构、里程碑、决策。决策已定，不自行推翻 |
| `PRODUCT.md` | 界面状态机、屏幕、交互、文案 |
| `DESIGN.md` | 设计令牌与组件视觉 |
| `../docs/接口设计.md` | 事件载荷、错误码、citations 偏移、缓存与回放的契约 |
| `../backend/app/pipeline/`、`../backend/tests/` | Python 参考实现。算法与测试以它为准，Go 版要对齐 |
| `../docs/mygo-skills/` | mygo 脚手架与设计令牌约定 |
| mygo 源码 `C:\Users\LHmile\go\pkg\mod\github.com\egoist\mygo@v0.8.3\` | API 以源码为准，文档与源码冲突信源码 |

## 2. 职责边界

- 只读写 `mygo/` 内的文件。不改 `../frontend/`、`../backend/`、`../docs/`、根目录文档。
- 需要主调度决定或改文档的事，写进汇报的「发现的其他问题」。
- 提交只 `git add mygo/`，约定式提交，含中文用 `git commit -F <文件>`。只提交，不推送。
- 上下文压缩后第一件事：确认 cwd 与职责边界。

## 3. 技术栈

| 项 | 版本 / 约定 |
| --- | --- |
| mygo | v0.8.3（锁定，不随意升级） |
| Go | 1.27.3，位于 `C:\Program Files\Go\bin`，不在 bash PATH，用完整路径或先加 PATH |
| Bun | 1.3.13 |
| 前端 | Vite + TypeScript + React（G1 任务 7 接入） |
| SQLite | 优先 `modernc.org/sqlite`（纯 Go），G1 实测 |
| 应用标识符 | `com.lhmile.mileaisearch`（G5 定稿） |

## 4. 目录约定

```text
mygo/
├── main.go            窗口创建、Bind、App.Run
├── mygo.config.ts     由模板生成，字段是运行期契约，不凭记忆改
├── internal/          Go 业务：search（流水线）、providers、ranker、cache、history、config
├── src/               前端：components、store（单一 reducer）、lib、tokens.css、mygo.ts（生成）
├── spike/             G1 技术验证最小代码，验证完留作参考
├── docs/              本端汇报与踩坑
└── resources/         icon.png（1024x1024）
```

## 5. mygo 硬规则

1. **不手写模板文件**：脚手架已由 `mygo init` 生成。需要新模板内容时照抄源码 `cmd\mygo\template\`。`mygo.config.ts` 的 `devUrl`、`devCommand`、`buildCommand`、`frontendDist`、`bindings`、`out` 和 `vite.config.ts` 的 `strictPort: 5173` 是运行期契约。
2. **`src/mygo.ts` 是生成物**：不手改。改了 Go 的绑定结构体或事件后运行 `mygo generate`。报 `no required module provides package github.com/egoist/mygo` 时先 `go mod tidy`。
3. **流式输出用 `*mygo.Channel[T]`**，它只能作为绑定方法的参数，不能嵌进其他结构体。页面 `break`、导航离开、关窗都会让 `Send` 失败并取消调用的 `ctx`。流水线里所有外部调用必须用这个 `ctx` 派生，不用 `context.Background()`。
4. **事件命名**：`mygo.NewEvent` 的名字不能以 `mygo:` 开头，名字会变成 `events.<name>`，用字母数字（如 `settingsChanged`），不用带冒号的名字。
5. **窗口 `BackgroundColor`** 与 `DESIGN.md` 的 `--canvas`（`#FBFBFA`）一致。
6. **复制 PNG 等二进制文件**用 `Copy-Item`，不要用文本写入工具。
7. `mygo build` 的 NSIS 要联网下载，验证阶段加 `-skip-installer`。

## 6. 全项目硬约束

1. **不编造**：模型名、接口地址、字段、包名拿不准就标「未确认」，先实测。Tavily 与 DeepSeek 的真实接口以 `../docs/外部依赖实测.md`（或 `../backend/docs/外部依赖实测.md`）为准。
2. **不用假数据**：耗时、计数、分数、共识度全部实算。接口调不通就停下报阻塞。开发期 mock 只允许放 `src/mocks/`，生产构建不得引用。原项目的 mock provider 不带。
3. **密钥**：只放环境变量或 `%APPDATA%\MileAISearch\.env`。不进仓库、不写日志、不进汇报、不回显明文。测试时可从 `../backend/.env` 读到进程环境，不得复制该文件进 `mygo/`。
4. **UTF-16 偏移**：citations 的所有偏移是 UTF-16 码元（JS `slice` 直接可用）。Go 字符串是 UTF-8 字节，必须转换，单测覆盖中文与 emoji 代理对。
5. **所有外部调用设超时**，沿用 `../backend/app/config.py` 的超时表。
6. **视觉只从令牌取值**：颜色、字号、圆角、阴影、间距只用 `src/tokens.css` 的变量，源码里不出现 hex、`rgb()`、Tailwind 任意值。
7. **状态机**：只有 `initial` / `retrieving` / `result` 三态，切换只在 reducer 里做。
8. **禁止 emoji**（代码、注释、文案、日志、文档）。图标用 SVG。
9. **编码**：所有文件 UTF-8 无 BOM，写完回读搜 `U+FFFD`。中文路径不用 shell 增删改。
10. **没有证据不算完成**：每次汇报至少附一项原始验证输出（`go test`、构建输出、日志、截图路径）。
11. **改动最小化**：只做当前任务，不顺手重构，发现的问题写进汇报。

## 7. 命令

```bash
# Go 不在 bash PATH 时
export PATH="/c/Program Files/Go/bin:/c/Users/LHmile/go/bin:$PATH"

mygo doctor                 # 环境自检
mygo dev                    # 开发，自动起 vite:5173 并弹窗
mygo generate               # 重新生成 src/mygo.ts
mygo build -skip-installer  # 出 exe，不下载 NSIS
go test ./...
bun run typecheck
bunx vitest run             # 前端单测;本机 `bun run test` 会命中系统 test 命令,不要用
```

端口 3000、8000 可能被其他 session 占用，不抢占，不结束不是自己启动的进程。控制台中文乱码不代表文件坏了，以文件真实字节为准。

## 8. 汇报

按 `../CLAUDE.md` §4 的格式，写到 `mygo/docs/<阶段>-完成汇报.md`，必须附原始验证输出、「知识点素材」。对 PRD 第 9 节里保守默认的三项（SQLite 驱动、应用标识符、45 秒看门狗）有意见时只提出，不自行改。
