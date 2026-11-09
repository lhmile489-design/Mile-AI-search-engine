// Package service hosts the bound services the page calls. For G2 these are
// contract stubs: every method returns an explicit "not implemented (G3)"
// error so `mygo generate` emits the real TypeScript types while the pipeline
// itself is built in G3. No stub returns fabricated data.
package service

import (
	"context"
	"errors"

	"github.com/egoist/mygo"

	"github.com/lhmile489-design/mile-ai-search/internal/contract"
)

// ErrNotImplemented is returned by every stub method until G3 wires the real
// pipeline. The message is surfaced to the page as the call's rejection.
var ErrNotImplemented = errors.New("not implemented (G3): pipeline arrives in the next milestone")

// SearchService is the page-facing search + history + config surface.
type SearchService struct{}

// Search streams StreamFrames for one request over ch (PRD §4.2). Stub: the
// error rejects the page's call, which the transport maps to the error state.
func (SearchService) Search(ctx context.Context, req contract.SearchRequest, ch *mygo.Channel[contract.StreamFrame]) error {
	return ErrNotImplemented
}

// Cancel aborts the in-flight run identified by runId. Stub.
func (SearchService) Cancel(runId string) error {
	return ErrNotImplemented
}

// GetConfig returns focusModes/engines/scopes/version (§13.5). Stub.
func (SearchService) GetConfig() (contract.AppConfig, error) {
	return contract.AppConfig{}, ErrNotImplemented
}

// GetSuggestions returns first-screen recommended questions (§13.6). Stub.
func (SearchService) GetSuggestions() (contract.SuggestionsData, error) {
	return contract.SuggestionsData{}, ErrNotImplemented
}

// ListHistory returns paged history cards (§13.2). Stub.
func (SearchService) ListHistory(page, pageSize int, q string) (contract.HistoryList, error) {
	return contract.HistoryList{}, ErrNotImplemented
}

// GetHistory returns one full snapshot (§13.3). Stub.
func (SearchService) GetHistory(id string) (contract.HistoryDetail, error) {
	return contract.HistoryDetail{}, ErrNotImplemented
}

// DeleteHistory removes one record (§13.4). Stub.
func (SearchService) DeleteHistory(id string) error {
	return ErrNotImplemented
}

// SaveSettings writes LLM/Tavily keys for the first-run settings page
// (PRODUCT §8). Write-only — keys are never returned by GetConfig. Stub.
func (SearchService) SaveSettings(s contract.Settings) error {
	return ErrNotImplemented
}
