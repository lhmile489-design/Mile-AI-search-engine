# G3a 完成汇报 · mygo session

向主调度汇报
任务：G3a Go 检索主链路（任务 0 到 8）
状态：部分完成。主链路、取消、窗口验证已完成；与 Python 版同题的 Top 信源对比未做（见「未完成」）。

## 完成内容

- 任务 0：Vite 与 `mygo.config.ts` 端口改为 5317（`strictPort` 保持），注释已更新。改前确认 5317 空闲。
- 任务 1：`internal/config`。读 `%APPDATA%\MileAISearch\.env`，进程环境优先；空值按未配置，`LLM_BASE_URL`、`LLM_MODEL` 回落默认值；超时表照抄 `config.py`；`Secret` 类型所有格式化动词只输出 `***`。`GetConfig` 返回真实引擎可用性，`GetSuggestions` 返回与 Python 相同的 5 条。
- 任务 2：`internal/provider`。Tavily、DeepSeek 搜索、LLM（非流式 Complete、流式 Stream）。`transport.go` 的 `tracedTransport` 用 `httptrace` 统计 started / wrote / done / canceled / failed。代理走环境变量。
- 任务 3：`internal/pipeline/rewrite.go`。Prompt、模式提示、范围提示、`ParseQueries`（直接解析，失败再正则抽取，最多 5 条）、失败降级为原问题加 50202，均照 `rewriter.py`。
- 任务 4：`search.go`。子检索词并发，每批到达即发 `sources(raw)`；主引擎失败切备用并发 `degraded` trace。URL 归一化、稳定 id、域名分类照契约 §4.2、§4.5。
- 任务 5：`rank.go`。三项加权、权重按 `focusMode`、缺时效时权重重分、DeepSeek 用 `rerank_score/3`、去重、范围过滤、Top K。非法 `scopeFilters` 与 `focusMode` 返回 40001。
- 任务 6：`generate.go`。信源编号与 `openui-lang` 签名照 `generator.py`，逐 chunk 推 `token` 帧。`done.citations` 为空，`related`、`takeaways` 不发。
- 任务 7：`run.go` 编排 + `internal/service/search.go`。顺序为 trace、sources、token、done，任一阶段失败发 `error` 帧。`Cancel(runId)` 已实现（空串或 `all` 取消全部）。每个阶段边界检查 `ctx.Err()`，取消日志格式为「客户端已断开，阶段=…，已取消 N 个在飞任务」。
- 任务 8：单测 `config_test.go`、`urlutil_test.go`、`rank_test.go`、`run_test.go`；真实冒烟 `internal/service/live_test.go`（`-tags=live`，默认不跑）。
- `src/mygo.ts` 已重新生成。

## 验证证据

Go 检查（原始输出）：

```text
vet-ok
Go test: 17 passed in 9 packages
$ tsc --noEmit
 Test Files  5 passed (5)
      Tests  78 passed (78)
```

构建与 mock 标识符：

```text
Built Mile AI Search 0.1.0 in 19.3s
  Mile AI Search.exe    13.8 MB
== mock grep
0
```

真实冒烟，同一问题「FlashAttention-3 FP8 内核在 Hopper GPU 上的吞吐基准与优化」，引擎 tavily：

```text
frame counts: map[done:1 sources:6 token:1658 trace:8]
frame order (runs): [trace sources trace sources trace token trace done]
raw sources: 50, ranked: 10, report chars: 3125
total: 15.4275642s
http started=7 done=7 canceled=0 failed=0
```

首 token 延迟值在输出里被占位符替换，未能原样贴出，请以 `go test -tags=live -run TestLiveFullRun -v ./internal/service` 复跑为准。

取消冒烟，检索开始 2 秒后取消：

```text
Run returned: context canceled, frames before cancel: 4
http started=6 done=2 canceled=4 failed=0
started 2s after return: 6 (delta 0)
2026/11/10 14:54:23 客户端已断开，阶段=searching，已取消 4 个在飞任务
```

断开后 2 秒内无新增外部调用（started 增量为 0）。

窗口验证：`mygo dev` 弹窗，输入真实问题，截图在 `docs/screenshots/G3a/`：`01-retrieving.png`、`02-result.png`、`03-after-esc.png`。Esc 后停止按钮消失、已生成正文保留。结果页显示 4/4 阶段完成、10 个信源、总耗时 17,174 ms。

## 如何复现验证

```bash
export PATH="/c/Program Files/Go/bin:$PATH"
go vet ./... && go test ./...
bun run typecheck && bun run test
# 真实冒烟（需要把 ../backend/.env 读进进程环境，不要复制进 mygo/）
go test -tags=live -run 'TestLiveFullRun|TestLiveCancelAfter2s' -v ./internal/service
mygo build -skip-installer
```

## 未完成 / 阻塞原因

- 与 Python 版同一问题的 Top 信源对比没有做。重排公式用 Python 实测值做了表驱动（`TestComputeScoreParityWithPython`、`TestURLParityWithPython`），但没有对同一问题并排跑两版。完成标准第 1 条的这一半未满足，需要后端 Python 服务运行时补做。
- 首 token 延迟的数字未能原样记录（见上）。

## 发现的其他问题

- `gofmt -l` 列出 `internal/contract/contract.go`、`internal/history/store.go`、`internal/textutil/utf16_test.go`，不是本轮改的，未动。
- 5173 被 szpu-takeout-admin 占用，所以改了 5317。机器上还有一个 5199 的 WebView2 页面，来自 G2 残留的会话，不是我本轮启动的，未处理。
- `SearchService.Cancel` 的请求不带 run id，目前是按本进程内自增 id 或 "all" 取消，前端若要精确取消，需要主调度在契约里定 runId 来源。
- 流水线里的 `search: primary ... failed` 日志包含上游错误文本，已确认只含上游名与 HTTP 状态，不含密钥。

## 知识点素材

- ctx 取消传播：`SearchService.Search` 用 `context.WithCancel(ctx)` 派生，Channel 关闭、窗口关闭都会取消它，所有外部请求都从该 ctx 派生（`internal/service/search.go`、`internal/provider/transport.go`）。
- 可观测的取消：`tracedTransport` 在 RoundTrip 与 body 关闭处按 `ctx.Err()` 区分 done 与 canceled，计数器给出 started / done / canceled。
- 并发检索与降级：`SearchAll` 每个子检索词一个 goroutine，结果经 channel 串行交给 `onBatch`，调用方无需加锁（`internal/pipeline/search.go`）。
- 重排：`ComputeScore` 对 DeepSeek 与 Tavily 走不同公式，缺时效时权重按比例重分（`internal/pipeline/rank.go`）。
- 密钥不泄露：`Secret` 实现 `String`、`GoString`、`MarshalText`，`%v` 与 JSON 都只输出 `***`（`internal/config/config.go`）。
