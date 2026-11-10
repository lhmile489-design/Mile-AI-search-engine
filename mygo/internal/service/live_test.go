//go:build live

package service

import (
	"bytes"
	"context"
	"log"
	"os"
	"testing"
	"time"

	"github.com/lhmile489-design/mile-ai-search/internal/config"
	"github.com/lhmile489-design/mile-ai-search/internal/contract"
	"github.com/lhmile489-design/mile-ai-search/internal/pipeline"
)

// Run: go test -tags=live -run Live -v ./internal/service
// Keys are read from ../../../backend/.env into the process environment only;
// nothing is copied into mygo/ and no key is printed.

const liveQuery = "FlashAttention-3 FP8 内核在 Hopper GPU 上的吞吐基准"

func loadBackendEnv(t *testing.T) {
	t.Helper()
	b, err := os.ReadFile("../../../backend/.env")
	if err != nil {
		t.Skipf("backend/.env not readable: %v", err)
	}
	for k, v := range config.ParseEnv(string(b)) {
		if v != "" && os.Getenv(k) == "" {
			os.Setenv(k, v)
		}
	}
}

func liveReq() contract.SearchRequest {
	return contract.SearchRequest{Query: liveQuery, FocusMode: "web", Engine: "tavily", ScopeFilters: []string{}}
}

func TestLiveFullRun(t *testing.T) {
	loadBackendEnv(t)
	deps := NewDeps(config.Load())
	counts := map[string]int{}
	var order []string
	var firstTok time.Duration
	var rawN, rankedN, chars int
	t0 := time.Now()
	err := pipeline.Run(context.Background(), deps, liveReq(), func(f contract.StreamFrame) error {
		counts[f.Type]++
		if len(order) == 0 || order[len(order)-1] != f.Type {
			order = append(order, f.Type)
		}
		switch f.Type {
		case "token":
			if firstTok == 0 {
				firstTok = time.Since(t0)
			}
			chars += len([]rune(f.Token.Delta))
		case "sources":
			if f.Sources.Phase == "raw" {
				rawN += len(f.Sources.Raw)
			} else {
				rankedN = len(f.Sources.Ranked)
				for _, s := range f.Sources.Ranked {
					t.Logf("rank %d  %.4f  %s  %s", *s.Index, *s.Scores.Final, s.Category, s.URL)
				}
			}
		case "error":
			t.Errorf("error frame: %+v", *f.Error)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	s, d, c, fl := Stats().Snapshot()
	t.Logf("frame counts: %v", counts)
	t.Logf("frame order (runs): %v", order)
	t.Logf("first token: %v, total: %v", firstTok, time.Since(t0))
	t.Logf("raw sources: %d, ranked: %d, report chars: %d", rawN, rankedN, chars)
	t.Logf("http started=%d done=%d canceled=%d failed=%d", s, d, c, fl)
}

func TestLiveCancelAfter2s(t *testing.T) {
	loadBackendEnv(t)
	var logBuf bytes.Buffer
	log.SetOutput(&logBuf)
	defer log.SetOutput(os.Stderr)

	deps := NewDeps(config.Load())
	s0, d0, c0, f0 := Stats().Snapshot()
	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(2*time.Second, cancel)
	sent := 0
	var closedAt time.Time
	err := pipeline.Run(ctx, deps, liveReq(), func(f contract.StreamFrame) error {
		if ctx.Err() != nil {
			if closedAt.IsZero() {
				closedAt = time.Now()
			}
			return context.Canceled // Channel closed: Send fails
		}
		sent++
		return nil
	})
	time.Sleep(500 * time.Millisecond)
	sA, dA, cA, fA := Stats().Snapshot()
	t.Logf("Run returned: %v, frames before cancel: %d", err, sent)
	t.Logf("http started=%d done=%d canceled=%d failed=%d", sA-s0, dA-d0, cA-c0, fA-f0)
	// no new external call after the disconnect
	time.Sleep(2 * time.Second)
	sB, _, _, _ := Stats().Snapshot()
	t.Logf("started 2s after return: %d (delta %d)", sB-s0, sB-sA)
	t.Logf("log:\n%s", logBuf.String())
	if sB != sA {
		t.Errorf("new external calls after disconnect: %d", sB-sA)
	}
	if sA-s0 != (dA-d0)+(cA-c0)+(fA-f0) {
		t.Errorf("in-flight requests unaccounted for")
	}
}
