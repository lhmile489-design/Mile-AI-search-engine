package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/lhmile489-design/mile-ai-search/internal/cache"
	"github.com/lhmile489-design/mile-ai-search/internal/config"
	"github.com/lhmile489-design/mile-ai-search/internal/contract"
	"github.com/lhmile489-design/mile-ai-search/internal/history"
	"github.com/lhmile489-design/mile-ai-search/internal/pipeline"
)

// ErrNotFound is the 40401 case: the history id does not exist.
var ErrNotFound = errors.New("历史记录不存在 (40401)")

var (
	sharedMu    sync.Mutex
	cacheStore  *pipeline.CacheStore
	cacheKey    string
	historyOnce *history.Store
	historyFail bool
)

// sharedCache returns the process-wide L1+L2 pair, rebuilt only when the
// cache settings change.
func sharedCache(cfg config.Config) *pipeline.CacheStore {
	sharedMu.Lock()
	defer sharedMu.Unlock()
	key := fmt.Sprintf("%v|%v|%d", cfg.CacheEnabled, cfg.CacheTTL, cfg.CacheMaxSize)
	if cacheStore == nil || key != cacheKey {
		cacheStore = cache.NewStore[pipeline.L1Entry, *pipeline.Snapshot](cfg.CacheEnabled, cfg.CacheMaxSize, cfg.CacheTTL, nil)
		cacheKey = key
	}
	return cacheStore
}

// sharedHistory opens the database on first use. A failure is logged once at
// error level and history stays off; searching keeps working.
func sharedHistory() *history.Store {
	sharedMu.Lock()
	defer sharedMu.Unlock()
	if historyOnce != nil || historyFail {
		return historyOnce
	}
	path, err := history.DefaultPath()
	if err == nil {
		historyOnce, err = history.Open(path)
	}
	if err != nil {
		historyFail = true
		historyOnce = nil
		log.Printf("level=error 打开历史库失败: 类型=%T 内容=%v", err, err)
	}
	return historyOnce
}

func isoOf(ms int64) string { return time.UnixMilli(ms).UTC().Format("2006-01-02T15:04:05.000Z") }

func unmarshalOpt[T any](s *string, dst *T) error {
	if s == nil {
		return nil
	}
	return json.Unmarshal([]byte(*s), dst)
}

// ListHistory returns paged history cards (§13.2).
func (SearchService) ListHistory(page, pageSize int, q string) (contract.HistoryList, error) {
	h := sharedHistory()
	if h == nil {
		return contract.HistoryList{}, errors.New("历史库不可用")
	}
	total, cards, err := h.List(context.Background(), page, pageSize, q)
	if err != nil {
		return contract.HistoryList{}, err
	}
	out := contract.HistoryList{Total: total, Records: []contract.HistoryCard{}}
	for _, c := range cards {
		out.Records = append(out.Records, contract.HistoryCard{
			ID: c.ID, Query: c.Query, FocusMode: c.FocusMode, Engine: c.Engine, CreatedAt: isoOf(c.CreatedAt),
			SourceCount: c.SourceCount, CharCount: c.CharCount, LatencyMs: c.LatencyMs, CacheHit: c.CacheHit,
		})
	}
	return out, nil
}

// GetHistory returns one full snapshot (§13.3).
func (SearchService) GetHistory(id string) (contract.HistoryDetail, error) {
	h := sharedHistory()
	if h == nil {
		return contract.HistoryDetail{}, errors.New("历史库不可用")
	}
	r, err := h.Get(context.Background(), id)
	if errors.Is(err, history.ErrNotFound) {
		return contract.HistoryDetail{}, ErrNotFound
	}
	if err != nil {
		return contract.HistoryDetail{}, err
	}
	return DetailOf(r)
}

// DetailOf maps a stored row to the contract shape.
func DetailOf(r history.Record) (contract.HistoryDetail, error) {
	d := contract.HistoryDetail{
		ID: r.ID, Query: r.Query, FocusMode: r.FocusMode, Engine: r.RequestedEngine, Degraded: r.Degraded,
		LatencyMs: r.LatencyMs, LLMModel: r.LLMModel, SourceCount: r.SourceCount, CharCount: r.CharCount,
		CacheHit: r.CacheHit, CreatedAt: isoOf(r.CreatedAt), UpdatedAt: isoOf(r.UpdatedAt),
	}
	report := r.ReportText
	d.Report = &report
	var timings contract.StageTimings
	var err error
	for _, step := range []func() error{
		func() error { return json.Unmarshal([]byte(r.EnginesUsed), &d.EnginesUsed) },
		func() error { return json.Unmarshal([]byte(r.ScopeFilters), &d.ScopeFilters) },
		func() error { return json.Unmarshal([]byte(r.RewrittenQueries), &d.RewrittenQueries) },
		func() error { return json.Unmarshal([]byte(r.StageTimings), &timings) },
		func() error { return json.Unmarshal([]byte(r.TraceEvents), &d.TraceEvents) },
		func() error { return json.Unmarshal([]byte(r.Sources), &d.Sources) },
		func() error { return unmarshalOpt(r.Citations, &d.Citations) },
		func() error { return unmarshalOpt(r.Takeaways, &d.Takeaways) },
		func() error { return unmarshalOpt(r.FollowUps, &d.FollowUps) },
		func() error { return unmarshalOpt(r.Consensus, &d.Consensus) },
		func() error { return unmarshalOpt(r.TokenStats, &d.TokenStats) },
	} {
		if err = step(); err != nil {
			return contract.HistoryDetail{}, fmt.Errorf("历史记录损坏: %w", err)
		}
	}
	d.StageTimings = &timings
	return d, nil
}

// DeleteHistory removes one record (§13.4).
func (SearchService) DeleteHistory(id string) error {
	h := sharedHistory()
	if h == nil {
		return errors.New("历史库不可用")
	}
	if err := h.Delete(context.Background(), id); errors.Is(err, history.ErrNotFound) {
		return ErrNotFound
	} else {
		return err
	}
}

// SaveSettings writes the keys into %APPDATA%\MileAISearch\.env. Empty values
// keep the old key. Config is re-read on every call, so the change is live
// immediately. Nothing about the values is logged.
func (SearchService) SaveSettings(s contract.Settings) error {
	return saveSettingsTo(config.EnvFilePath(), s)
}

func saveSettingsTo(path string, s contract.Settings) error {
	if err := config.SaveKeys(path, map[string]string{
		"LLM_API_KEY": s.LLMAPIKey, "TAVILY_API_KEY": s.TavilyAPIKey,
	}); err != nil {
		log.Printf("level=error 保存设置失败: 类型=%T", err)
		return err
	}
	return nil
}

// CloseShared closes the process-wide history store and drops the cached
// cache pair, so the next call reopens from the current %APPDATA%. Tests use it
// to release the database file before a temp directory is removed.
func CloseShared() {
	sharedMu.Lock()
	defer sharedMu.Unlock()
	if historyOnce != nil {
		_ = historyOnce.Close()
	}
	historyOnce = nil
	historyFail = false
	cacheStore = nil
	cacheKey = ""
}
