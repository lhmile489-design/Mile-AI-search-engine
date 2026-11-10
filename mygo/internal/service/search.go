// Package service hosts the bound services the page calls. Search, GetConfig,
// GetSuggestions and Cancel are real (G3a); history and settings stay stubs
// until G3b. No stub returns fabricated data.
package service

import (
	"context"
	"errors"
	"strconv"
	"sync"

	"github.com/egoist/mygo"

	"github.com/lhmile489-design/mile-ai-search/internal/config"
	"github.com/lhmile489-design/mile-ai-search/internal/contract"
	"github.com/lhmile489-design/mile-ai-search/internal/pipeline"
	"github.com/lhmile489-design/mile-ai-search/internal/provider"
)

// ErrNotImplemented is returned by the methods that arrive in G3b.
var ErrNotImplemented = errors.New("not implemented (G3b): arrives in the next milestone")

// Shared state. SearchService is bound by value, so the registry and HTTP
// stats live at package level.
var (
	httpStats provider.Stats

	runsMu sync.Mutex
	runSeq int
	runs   = map[string]context.CancelFunc{}
)

// Stats exposes the outbound request counters (started/done/canceled/failed)
// for smoke tests and diagnostics.
func Stats() *provider.Stats { return &httpStats }

// Suggestions is the fixed first-screen list (same five as the Python backend).
var Suggestions = []string{
	"FlashAttention-3 FP8 内核在 Hopper GPU 上的吞吐基准与优化",
	"NVIDIA TMA 异步拷贝指令在 CUDA 内核中的使用方式",
	"大语言模型量化方法 GPTQ、AWQ、SmoothQuant 对比",
	"vLLM PagedAttention 原理与实现细节",
	"Transformer 推理加速：Speculative Decoding 原理与效果",
}

// SearchService is the page-facing search + history + config surface.
type SearchService struct{}

// NewDeps builds pipeline dependencies from cfg. Exported for smoke tests.
func NewDeps(cfg config.Config) pipeline.Deps {
	hc := provider.NewHTTPClient(&httpStats)
	llm := &provider.LLM{Client: hc, BaseURL: cfg.LLMBaseURL, Key: cfg.LLMAPIKey, Model: cfg.LLMModel}
	return pipeline.Deps{
		Cfg: cfg,
		LLM: llm,
		Providers: func(engine string) (provider.Provider, provider.Provider, bool) {
			tav := func() provider.Provider { return &provider.Tavily{Key: cfg.TavilyAPIKey, HTTP: hc} }
			ds := func() provider.Provider { return &provider.DeepSeekSearch{Key: cfg.LLMAPIKey, HTTP: hc} }
			switch {
			case engine == "tavily" && cfg.TavilyAPIKey.Set():
				if cfg.LLMAPIKey.Set() {
					return tav(), ds(), true
				}
				return tav(), nil, true
			case engine == "deepseek" && cfg.LLMAPIKey.Set():
				if cfg.TavilyAPIKey.Set() {
					return ds(), tav(), true
				}
				return ds(), nil, true
			}
			return nil, nil, false
		},
	}
}

// Search streams StreamFrames for one request over ch. The call's ctx is
// canceled when the page closes the Channel or the window goes away, and every
// outbound request derives from it.
func (SearchService) Search(ctx context.Context, req contract.SearchRequest, ch *mygo.Channel[contract.StreamFrame]) error {
	rctx, cancel := context.WithCancel(ctx)
	defer cancel()

	runsMu.Lock()
	runSeq++
	id := strconv.Itoa(runSeq)
	runs[id] = cancel
	runsMu.Unlock()
	defer func() {
		runsMu.Lock()
		delete(runs, id)
		runsMu.Unlock()
	}()

	deps := NewDeps(config.Load())
	err := pipeline.Run(rctx, deps, req, func(f contract.StreamFrame) error { return ch.Send(f) })
	if rctx.Err() != nil {
		return nil // client went away; nothing left to report
	}
	return err
}

// Cancel aborts in-flight runs. The request carries no run id, so "" or "all"
// cancels every run; a numeric id cancels that run only.
func (SearchService) Cancel(runId string) error {
	runsMu.Lock()
	defer runsMu.Unlock()
	for id, c := range runs {
		if runId == "" || runId == "all" || runId == id {
			c()
		}
	}
	return nil
}

var focusModes = []contract.ConfigOption{
	{Value: "web", Label: "通用网络", Description: "综合搜索，适合大多数问题"},
	{Value: "academic", Label: "学术研究", Description: "偏重预印本、会议论文、权威来源"},
	{Value: "code", Label: "代码实现", Description: "偏重代码仓库、文档、包仓库"},
}

var scopes = []contract.ConfigOption{
	{Value: "preprint", Label: "学术预印本", Description: "arXiv、OpenReview 等"},
	{Value: "code", Label: "代码仓库", Description: "GitHub、GitLab 等"},
	{Value: "spec", Label: "规范与协议", Description: "RFC、W3C、WHATWG 等"},
	{Value: "docs", Label: "官方文档", Description: "框架与产品官方文档站"},
	{Value: "blog", Label: "技术博客", Description: "博客、评测、社区讨论"},
}

// BuildConfig reports engine availability from cfg (only keyed engines).
func BuildConfig(cfg config.Config) contract.AppConfig {
	engines := []contract.EngineOption{}
	if cfg.TavilyAPIKey.Set() {
		engines = append(engines, contract.EngineOption{Value: "tavily", Label: "Tavily", Available: true})
	}
	if cfg.LLMAPIKey.Set() {
		engines = append(engines, contract.EngineOption{Value: "deepseek", Label: "DeepSeek", Available: true})
	}
	return contract.AppConfig{FocusModes: focusModes, Engines: engines, Scopes: scopes, Version: "0.1.0"}
}

// GetConfig returns focusModes/engines/scopes/version (§13.5).
func (SearchService) GetConfig() (contract.AppConfig, error) {
	return BuildConfig(config.Load()), nil
}

// GetSuggestions returns first-screen recommended questions (§13.6).
func (SearchService) GetSuggestions() (contract.SuggestionsData, error) {
	return contract.SuggestionsData{Items: Suggestions}, nil
}

// ListHistory returns paged history cards (§13.2). G3b.
func (SearchService) ListHistory(page, pageSize int, q string) (contract.HistoryList, error) {
	return contract.HistoryList{}, ErrNotImplemented
}

// GetHistory returns one full snapshot (§13.3). G3b.
func (SearchService) GetHistory(id string) (contract.HistoryDetail, error) {
	return contract.HistoryDetail{}, ErrNotImplemented
}

// DeleteHistory removes one record (§13.4). G3b.
func (SearchService) DeleteHistory(id string) error {
	return ErrNotImplemented
}

// SaveSettings writes LLM/Tavily keys (PRODUCT §8). Write-only. G3b.
func (SearchService) SaveSettings(s contract.Settings) error {
	return ErrNotImplemented
}
