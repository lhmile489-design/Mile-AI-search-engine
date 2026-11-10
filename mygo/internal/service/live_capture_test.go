//go:build live

package service

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/lhmile489-design/mile-ai-search/internal/config"
	"github.com/lhmile489-design/mile-ai-search/internal/provider"
)

// TestLiveCaptureRankInput stores the raw provider hits of a few real
// sub-queries as the fixed input for the rerank parity test. Run once:
//
//	go test -tags=live -run TestLiveCaptureRankInput -v ./internal/service
//
// The file holds search results only; no key is written.
func TestLiveCaptureRankInput(t *testing.T) {
	loadBackendEnv(t)
	deps := NewDeps(config.Load())
	primary, _, ok := deps.Providers("tavily")
	if !ok {
		t.Skip("tavily not configured")
	}
	queries := []string{
		liveQuery,
		"FlashAttention-3 FP8 Hopper benchmark",
		"FlashAttention-3 WGMMA TMA warp specialization",
	}
	var all []provider.Source
	for i, q := range queries {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		res, err := primary.Search(ctx, q, 10, nil)
		cancel()
		if err != nil {
			t.Fatalf("query %d: %v", i, err)
		}
		for j := range res {
			res[j].MatchedQueries = []int{i}
		}
		all = append(all, res...)
	}
	b, err := json.MarshalIndent(all, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile("../pipeline/testdata/rank_input.json", b, 0o644); err != nil {
		t.Fatal(err)
	}
	t.Logf("captured %d sources", len(all))
}
