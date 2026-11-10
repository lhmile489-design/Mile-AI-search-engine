package pipeline

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	"github.com/lhmile489-design/mile-ai-search/internal/cache"
	"github.com/lhmile489-design/mile-ai-search/internal/contract"
	"github.com/lhmile489-design/mile-ai-search/internal/history"
	"github.com/lhmile489-design/mile-ai-search/internal/provider"
)

// L1Entry is one cached sub-query result. Engine is the engine that really
// answered, so a hit reports it unchanged (no suffix).
type L1Entry struct {
	Engine  string
	Sources []provider.Source
}

// RawBatch is one phase=raw frame of a finished run.
type RawBatch struct {
	Index  int
	Engine string
	Items  []contract.RawSource
}

// Snapshot is everything a finished run produced, minus anything measured in
// time. Replay never reads a duration from it (decision D4).
type Snapshot struct {
	Queries     []string
	Raw         []RawBatch
	Ranked      []contract.SourceCard
	Stats       map[string]any
	Report      string
	Citations   []contract.Citation
	Takeaways   []contract.Takeaway
	FollowUps   []string
	Consensus   *contract.Consensus
	TokenStats  *contract.TokenStats
	EnginesUsed []string
	Degraded    bool
	CharCount   int
}

// CacheStore is the L1 + L2 pair the pipeline uses.
type CacheStore = cache.Store[L1Entry, *Snapshot]

// HistoryWriter is the write side of the history store.
type HistoryWriter interface {
	Insert(ctx context.Context, r history.Record) error
}

func cloneSources(in []provider.Source) []provider.Source {
	out := make([]provider.Source, len(in))
	for i, s := range in {
		s.MatchedQueries = append([]int(nil), s.MatchedQueries...)
		out[i] = s
	}
	return out
}

// runInfo carries the measured values of one run into persist.
type runInfo struct {
	Timings   contract.StageTimings
	LatencyMs int64
	Traces    []contract.TracePayload
	CacheHit  bool
}

func newHistoryID(now time.Time) string {
	var b [4]byte
	_, _ = rand.Read(b[:])
	return fmt.Sprintf("hist_%d_%s", now.UnixMilli(), hex.EncodeToString(b[:]))
}

func arr[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

func jsonOf(v any) (string, error) {
	b, err := json.Marshal(v)
	return string(b), err
}

func optJSON(isNil bool, v any) (*string, error) {
	if isNil {
		return nil, nil
	}
	s, err := jsonOf(v)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func buildRecord(d Deps, req contract.SearchRequest, snap *Snapshot, ri runInfo, now time.Time) (history.Record, error) {
	var r history.Record
	var err error
	var raw []contract.RawSource
	for _, b := range snap.Raw {
		raw = append(raw, b.Items...)
	}
	cols := []struct {
		dst *string
		v   any
	}{
		{&r.EnginesUsed, arr(snap.EnginesUsed)},
		{&r.ScopeFilters, arr(req.ScopeFilters)},
		{&r.RewrittenQueries, arr(snap.Queries)},
		{&r.StageTimings, ri.Timings},
		{&r.TraceEvents, arr(ri.Traces)},
		{&r.RawSources, arr(raw)},
		{&r.Sources, arr(snap.Ranked)},
	}
	for _, c := range cols {
		if *c.dst, err = jsonOf(c.v); err != nil {
			return r, err
		}
	}
	cit, err := jsonOf(arr(snap.Citations))
	if err != nil {
		return r, err
	}
	r.Citations = &cit
	if r.Takeaways, err = optJSON(snap.Takeaways == nil, snap.Takeaways); err != nil {
		return r, err
	}
	if r.FollowUps, err = optJSON(snap.FollowUps == nil, snap.FollowUps); err != nil {
		return r, err
	}
	if r.Consensus, err = optJSON(snap.Consensus == nil, snap.Consensus); err != nil {
		return r, err
	}
	tokens := snap.TokenStats
	if ri.CacheHit {
		tokens = nil // a replay consumed no tokens
	}
	if r.TokenStats, err = optJSON(tokens == nil, tokens); err != nil {
		return r, err
	}
	model := d.Cfg.LLMModel
	r.LLMModel = &model
	r.ID = newHistoryID(now)
	r.Query = req.Query
	r.FocusMode = req.FocusMode
	r.RequestedEngine = req.Engine
	r.Degraded = snap.Degraded
	r.ReportText = snap.Report
	r.LatencyMs = ri.LatencyMs
	r.SourceCount = len(snap.Ranked)
	r.CharCount = snap.CharCount
	r.CacheHit = ri.CacheHit
	r.CreatedAt = now.UnixMilli()
	r.UpdatedAt = r.CreatedAt
	return r, nil
}

// persist writes the snapshot as a new history row and returns its id. A
// failure never reaches the response: it is logged at error level with the
// error type and text, and the id comes back nil.
func persist(ctx context.Context, d Deps, req contract.SearchRequest, snap *Snapshot, ri runInfo) *string {
	if d.History == nil {
		return nil
	}
	rec, err := buildRecord(d, req, snap, ri, time.Now())
	if err == nil {
		err = d.History.Insert(ctx, rec)
	}
	if err != nil {
		log.Printf("level=error 写入历史失败: 类型=%T 内容=%v", err, err)
		return nil
	}
	return &rec.ID
}

func sortRaw(b []RawBatch) {
	sort.Slice(b, func(i, j int) bool { return b[i].Index < b[j].Index })
}

// chunkRunes splits s into pieces of at most n runes.
func chunkRunes(s string, n int) []string {
	r := []rune(s)
	var out []string
	for len(r) > 0 {
		k := n
		if len(r) < k {
			k = len(r)
		}
		out = append(out, string(r[:k]))
		r = r[k:]
	}
	return out
}

const replayChunk = 40

// replay re-emits a cached run as the normal frame sequence. Every duration
// is measured here, now; nothing time-valued is read from snap.
func replay(ctx context.Context, d Deps, req contract.SearchRequest, snap *Snapshot, t0 time.Time,
	emit func(contract.StreamFrame) bool, stopped func() bool, traces func() []contract.TracePayload) error {
	atMs := func() int64 { return time.Since(t0).Milliseconds() }
	var recorded []contract.TracePayload
	trace := func(step, status, msg string, elapsed *int64, detail map[string]any) bool {
		tp := contract.TracePayload{
			Step: step, Status: status, AtMs: atMs(), ElapsedMs: elapsed, Message: msg, Detail: detail, CacheHit: true,
		}
		recorded = append(recorded, tp)
		return emit(contract.StreamFrame{Type: "trace", Trace: &tp})
	}
	since := func(t time.Time) int64 { return time.Since(t).Milliseconds() }

	t := time.Now()
	trace("rewriting", "start", "开始改写检索词（缓存回放）", nil, nil)
	rewriteMs := since(t)
	trace("rewriting", "end", fmt.Sprintf("改写出 %d 个检索词（缓存回放）", len(snap.Queries)), ip(rewriteMs),
		map[string]any{"queries": snap.Queries, "fallback": false, "fallbackCode": nil})
	if stopped() {
		return ctx.Err()
	}

	t = time.Now()
	trace("searching", "start", "开始并发检索（缓存回放）", nil, map[string]any{"engine": req.Engine, "queryCount": len(snap.Queries)})
	rawN := 0
	for _, b := range snap.Raw {
		if stopped() {
			return ctx.Err()
		}
		qi := b.Index
		rawN += len(b.Items)
		emit(contract.StreamFrame{Type: "sources", Sources: &contract.SourcesPayload{
			Phase: "raw", Engine: b.Engine, QueryIndex: &qi, Raw: b.Items,
		}})
	}
	searchMs := since(t)
	trace("searching", "end", fmt.Sprintf("检索完成，共 %d 条（缓存回放）", rawN), ip(searchMs),
		map[string]any{"enginesUsed": snap.EnginesUsed, "rawCount": rawN, "failedQueries": []int{}})
	if stopped() {
		return ctx.Err()
	}

	t = time.Now()
	trace("reasoning", "start", "开始分类重排（缓存回放）", nil, nil)
	emit(contract.StreamFrame{Type: "sources", Sources: &contract.SourcesPayload{
		Phase: "ranked", Engine: req.Engine, Ranked: snap.Ranked,
	}})
	reasonMs := since(t)
	trace("reasoning", "end", fmt.Sprintf("重排完成，取前 %d 个信源（缓存回放）", len(snap.Ranked)), ip(reasonMs), snap.Stats)
	if stopped() {
		return ctx.Err()
	}

	t = time.Now()
	trace("generating", "start", "开始生成研报（缓存回放）", nil, map[string]any{"model": d.Cfg.LLMModel, "sourceCount": len(snap.Ranked)})
	var firstTokenMs *int64
	for _, c := range chunkRunes(snap.Report, replayChunk) {
		if stopped() {
			return ctx.Err()
		}
		if firstTokenMs == nil {
			v := atMs()
			firstTokenMs = &v
		}
		emit(contract.StreamFrame{Type: "token", Token: &contract.TokenPayload{Delta: c}})
	}
	genMs := since(t)
	var genFirst any
	if firstTokenMs != nil {
		genFirst = *firstTokenMs - (t.Sub(t0).Milliseconds())
	}
	trace("generating", "end", fmt.Sprintf("研报生成完成，共 %d 字（缓存回放）", snap.CharCount), ip(genMs),
		map[string]any{"firstTokenMs": genFirst, "charCount": snap.CharCount})

	t = time.Now()
	if snap.FollowUps != nil {
		emit(contract.StreamFrame{Type: "related", Related: &contract.RelatedPayload{Items: snap.FollowUps}})
	}
	if stopped() {
		return ctx.Err()
	}
	timings := contract.StageTimings{RewritingMs: rewriteMs, SearchingMs: searchMs, ReasoningMs: reasonMs, GeneratingMs: genMs, FinalizingMs: since(t)}
	latency := atMs()
	rs := *snap
	rs.TokenStats = nil
	histID := persist(ctx, d, req, &rs, runInfo{Timings: timings, LatencyMs: latency, Traces: recorded, CacheHit: true})
	emit(contract.StreamFrame{Type: "done", Done: &contract.DonePayload{
		HistoryID: histID, LatencyMs: latency, StageTimings: timings, FirstTokenMs: firstTokenMs,
		Citations: snap.Citations, Takeaways: snap.Takeaways, Consensus: snap.Consensus,
		Engine: req.Engine, EnginesUsed: snap.EnginesUsed, Degraded: snap.Degraded,
		SourceCount: len(snap.Ranked), CharCount: snap.CharCount, CacheHit: true,
	}})
	return nil
}

var _ = strings.TrimSpace
