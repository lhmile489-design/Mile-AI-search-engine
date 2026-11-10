package pipeline

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/lhmile489-design/mile-ai-search/internal/cache"
	"github.com/lhmile489-design/mile-ai-search/internal/config"
	"github.com/lhmile489-design/mile-ai-search/internal/contract"
	"github.com/lhmile489-design/mile-ai-search/internal/provider"
)

// Sink delivers one frame to the page. A non-nil error means the page is gone
// (Channel closed); Run treats that exactly like a canceled ctx.
type Sink func(contract.StreamFrame) error

// Deps are the collaborators Run needs. Providers picks the primary and the
// fallback engine for a requested engine; ok=false means it is not configured.
type Deps struct {
	Cfg       config.Config
	LLM       LLM
	Providers func(engine string) (primary, fallback provider.Provider, ok bool)
	Now       func() time.Time
	Cache     *CacheStore   // optional L1 + L2
	History   HistoryWriter // optional
}

var (
	validFocus = map[string]bool{"academic": true, "code": true, "web": true}
	validScope = map[string]bool{"preprint": true, "code": true, "spec": true, "docs": true, "blog": true}
)

// ValidateRequest returns a 40001 message for a bad request, "" when valid.
func ValidateRequest(req contract.SearchRequest) string {
	n := utf8.RuneCountInString(req.Query)
	if n < 1 || n > 500 {
		return "query 长度需要在 1 到 500 个字符之间"
	}
	if !validFocus[req.FocusMode] {
		return "focusMode 取值非法：" + req.FocusMode
	}
	for _, s := range req.ScopeFilters {
		if !validScope[s] {
			return "scopeFilters 含非法取值：" + s
		}
	}
	return ""
}

func ip(v int64) *int64   { return &v }
func sp(v string) *string { return &v }

func upstreamOf(engine string) string {
	if engine == "tavily" {
		return "tavily"
	}
	return "deepseek_search"
}

// Run executes rewrite, search, rank and generate, pushing frames in contract
// order. It returns nil once a done or error frame has been sent, and ctx's
// error (after logging the disconnect line) when the client went away.
func Run(ctx context.Context, d Deps, req contract.SearchRequest, send Sink) error {
	t0 := time.Now()
	if d.Now == nil {
		d.Now = time.Now
	}
	atMs := func() int64 { return time.Since(t0).Milliseconds() }
	phase := "init"
	canceled := 0
	gone := false

	emit := func(f contract.StreamFrame) bool {
		if gone {
			return false
		}
		if err := send(f); err != nil {
			gone = true
			return false
		}
		return true
	}
	var traces []contract.TracePayload
	traceC := func(step, status, msg string, elapsed *int64, detail map[string]any, hit bool) bool {
		tp := contract.TracePayload{
			Step: step, Status: status, AtMs: atMs(), ElapsedMs: elapsed, Message: msg, Detail: detail, CacheHit: hit,
		}
		traces = append(traces, tp)
		return emit(contract.StreamFrame{Type: "trace", Trace: &tp})
	}
	trace := func(step, status, msg string, elapsed *int64, detail map[string]any) bool {
		return traceC(step, status, msg, elapsed, detail, false)
	}
	fail := func(code int, msg string, step *string, retry bool, upstream *string) error {
		emit(contract.StreamFrame{Type: "error", Error: &contract.ErrorPayload{
			Code: code, Message: msg, Step: step, Retryable: retry, Upstream: upstream,
		}})
		return nil
	}
	// stopped logs the disconnect once and reports whether to bail out.
	stopped := func() bool {
		if gone || ctx.Err() != nil {
			log.Printf("客户端已断开，阶段=%s，已取消 %d 个在飞任务", phase, canceled)
			return true
		}
		return false
	}

	if msg := ValidateRequest(req); msg != "" {
		return fail(40001, msg, nil, false, nil)
	}
	primary, fallback, ok := d.Providers(req.Engine)
	if !ok {
		return fail(40002, "引擎 "+req.Engine+" 未配置密钥", nil, false, nil)
	}

	// ---- L2: replay a finished identical run ----
	l2Key := cache.L2Key(req.Query, req.FocusMode, req.Engine, req.ScopeFilters)
	if snap, hit := d.Cache.GetL2(l2Key); hit {
		return replay(ctx, d, req, snap, t0, emit, stopped, func() []contract.TracePayload { return traces })
	}

	// ---- rewriting ----
	phase = "rewriting"
	if stopped() {
		return ctx.Err()
	}
	tr := time.Now()
	trace("rewriting", "start", "开始改写检索词", nil, nil)
	queries, fb, code := Rewrite(ctx, d.LLM, d.Cfg.Timeouts.Rewrite, req.Query, req.FocusMode, req.ScopeFilters)
	rewriteMs := time.Since(tr).Milliseconds()
	var fbCode any
	if fb {
		fbCode = code
	}
	msg := fmt.Sprintf("改写出 %d 个检索词", len(queries))
	if fb {
		msg += "（降级）"
	}
	trace("rewriting", "end", msg, ip(rewriteMs), map[string]any{
		"queries": queries, "fallback": fb, "fallbackCode": fbCode,
	})

	// ---- searching ----
	phase = "searching"
	if stopped() {
		return ctx.Err()
	}
	ts := time.Now()
	trace("searching", "start", "开始并发检索", nil, map[string]any{"engine": req.Engine, "queryCount": len(queries)})
	var batches []Batch
	var all []provider.Source
	failed := []int{}
	degradedSent := false
	degraded := false
	plan := SearchPlan{Primary: primary, Fallback: fallback, Queries: queries, Scope: req.ScopeFilters, Timeout: d.Cfg.Timeouts.Search, Cache: d.Cache, Engine: req.Engine}
	var rawBatches []RawBatch
	l1Hits := 0
	canceled = SearchAll(ctx, plan, func(b Batch) bool {
		batches = append(batches, b)
		if b.CacheHit {
			l1Hits++
		}
		if len(b.Sources) == 0 {
			failed = append(failed, b.Index)
			return true
		}
		all = append(all, b.Sources...)
		if b.Degraded {
			degraded = true
			if !degradedSent {
				degradedSent = true
				trace("searching", "degraded", "主引擎失败，已切换到 "+b.Engine, nil, map[string]any{
					"from": primary.Name(), "to": b.Engine, "code": 50201, "queryIndex": b.Index,
				})
			}
		}
		raw := make([]contract.RawSource, 0, len(b.Sources))
		for _, s := range b.Sources {
			raw = append(raw, RawCard(s))
		}
		qi := b.Index
		rawBatches = append(rawBatches, RawBatch{Index: b.Index, Engine: b.Engine, Items: raw})
		return emit(contract.StreamFrame{Type: "sources", Sources: &contract.SourcesPayload{
			Phase: "raw", Engine: b.Engine, QueryIndex: &qi, Raw: raw,
		}})
	})
	if stopped() {
		return ctx.Err()
	}
	canceled = 0
	enginesUsed := EnginesUsed(batches)
	searchMs := time.Since(ts).Milliseconds()
	traceC("searching", "end", fmt.Sprintf("检索完成，共 %d 条（去重前）", len(all)), ip(searchMs), map[string]any{
		"enginesUsed": enginesUsed, "rawCount": len(all), "failedQueries": failed, "l1Hits": l1Hits,
	}, l1Hits > 0)
	if len(all) == 0 {
		return fail(50201, "所有子检索词均未返回结果，请稍后重试", sp("searching"), true, sp(upstreamOf(req.Engine)))
	}

	// ---- reasoning (rerank) ----
	phase = "reasoning"
	if stopped() {
		return ctx.Err()
	}
	tg := time.Now()
	trace("reasoning", "start", "开始分类重排", nil, nil)
	ranked := RankSources(all, req.FocusMode, req.ScopeFilters, d.Cfg.RankingTopK, d.Now())
	for i := range ranked {
		if bib := GenerateBibtex(ranked[i].Category, ranked[i].Title, ranked[i].URL, deref(ranked[i].PublishedAt)); bib != "" {
			b := bib
			ranked[i].BibTeX = &b
		}
	}
	emit(contract.StreamFrame{Type: "sources", Sources: &contract.SourcesPayload{
		Phase: "ranked", Engine: req.Engine, Ranked: ranked,
	}})
	reasonMs := time.Since(tg).Milliseconds()
	var stats map[string]any
	b, _ := json.Marshal(Stats(all, req.ScopeFilters, len(ranked)))
	_ = json.Unmarshal(b, &stats)
	trace("reasoning", "end", fmt.Sprintf("重排完成，取前 %d 个信源", len(ranked)), ip(reasonMs), stats)

	// ---- generating ----
	phase = "generating"
	if stopped() {
		return ctx.Err()
	}
	tgen := time.Now()
	trace("generating", "start", "开始生成研报", nil, map[string]any{"model": d.Cfg.LLMModel, "sourceCount": len(ranked)})
	var report strings.Builder
	res, err := Generate(ctx, d.LLM, d.Cfg.Timeouts.GenerateFirstTk, req.Query, ranked, func(delta string) error {
		report.WriteString(delta)
		if !emit(contract.StreamFrame{Type: "token", Token: &contract.TokenPayload{Delta: delta}}) {
			return context.Canceled
		}
		return nil
	})
	if err != nil {
		if stopped() {
			return ctx.Err()
		}
		text := err.Error()
		if errors.Is(err, provider.ErrTimeout) {
			text = "生成研报超时（30 秒内没有收到首个 token）"
		}
		if r := []rune(text); len(r) > 200 {
			text = string(r[:200])
		}
		return fail(50202, text, sp("generating"), true, sp("llm"))
	}
	if stopped() {
		return ctx.Err()
	}
	genMs := time.Since(tgen).Milliseconds()
	var firstTokenMs *int64
	var genFirst any
	if res.FirstTokenMs >= 0 {
		v := tgen.Sub(t0).Milliseconds() + res.FirstTokenMs
		firstTokenMs = &v
		genFirst = res.FirstTokenMs
	}
	trace("generating", "end", fmt.Sprintf("研报生成完成，共 %d 字", res.Chars), ip(genMs), map[string]any{
		"firstTokenMs": genFirst, "charCount": res.Chars,
	})

	// ---- finalizing: balance fences first so offsets match the final text ----
	phase = "finalizing"
	tf := time.Now()
	text, dropped := BalanceFences(report.String())
	if dropped {
		trace("generating", "degraded", "正文含未闭合的 openui-lang 围栏，已移除该块", nil, map[string]any{"reason": "unclosed_fence"})
	}
	cits, hallucinated := ParseCitations(text, ranked)
	if len(hallucinated) > 0 {
		trace("generating", "degraded", fmt.Sprintf("正文含 %d 个越界引用编号，已保留在正文且不生成引用", len(hallucinated)), nil,
			map[string]any{"reason": "hallucinated_citation", "numbers": hallucinated})
	}
	consensus := ComputeConsensus(text, cits, ranked)
	fin, reason := Finalize(ctx, d.LLM, d.Cfg.Timeouts.Finalize, text)
	if stopped() {
		return ctx.Err()
	}
	if reason != "" {
		trace("generating", "degraded", "收尾调用降级："+reason, nil, map[string]any{"reason": "finalize_failed", "detail": reason})
	}
	if fin.FollowUps != nil {
		emit(contract.StreamFrame{Type: "related", Related: &contract.RelatedPayload{Items: fin.FollowUps}})
	}
	finMs := time.Since(tf).Milliseconds()

	sort.Slice(rawBatches, func(i, j int) bool { return rawBatches[i].Index < rawBatches[j].Index })
	snap := &Snapshot{
		Queries: queries, Raw: rawBatches, Ranked: ranked, Stats: stats, Report: text,
		Citations: cits, Takeaways: fin.Takeaways, FollowUps: fin.FollowUps, Consensus: consensus,
		TokenStats: res.Usage, EnginesUsed: enginesUsed, Degraded: degraded, CharCount: res.Chars,
	}
	timings := contract.StageTimings{
		RewritingMs: rewriteMs, SearchingMs: searchMs, ReasoningMs: reasonMs, GeneratingMs: genMs, FinalizingMs: finMs,
	}
	latency := atMs()
	histID := persist(ctx, d, req, snap, runInfo{Timings: timings, LatencyMs: latency, Traces: traces})
	doneOK := emit(contract.StreamFrame{Type: "done", Done: &contract.DonePayload{
		HistoryID:    histID,
		LatencyMs:    latency,
		StageTimings: timings,
		FirstTokenMs: firstTokenMs,
		TokenStats:   res.Usage,
		Citations:    cits,
		Takeaways:    fin.Takeaways,
		Consensus:    consensus,
		Engine:       req.Engine,
		EnginesUsed:  enginesUsed,
		Degraded:     degraded,
		SourceCount:  len(ranked),
		CharCount:    res.Chars,
	}})
	if doneOK {
		d.Cache.SetL2(l2Key, snap) // only runs that reached done are cached
	}
	log.Printf("完成，总耗时 %dms，信源 %d，研报 %d 字", atMs(), len(ranked), res.Chars)
	return nil
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
