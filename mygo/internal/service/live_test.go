//go:build live

package service

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"testing"
	"time"
	"unicode/utf16"

	"github.com/lhmile489-design/mile-ai-search/internal/config"
	"github.com/lhmile489-design/mile-ai-search/internal/contract"
	"github.com/lhmile489-design/mile-ai-search/internal/pipeline"
)

// Run: go test -tags=live -run Live -v ./internal/service
// Keys are read from ../../../backend/.env into the process environment only;
// nothing is copied into mygo/ and no key is printed.

const liveQuery = "FlashAttention-3 FP8 内核在 Hopper GPU 上的吞吐基准与优化"

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
				for _, r := range f.Sources.Raw {
					t.Logf("raw %s", r.URL)
				}
			} else {
				rankedN = len(f.Sources.Ranked)
				for _, s := range f.Sources.Ranked {
					t.Logf("rank %d  %.4f  %s  %s", *s.Index, *s.Scores.Final, s.Category, s.URL)
				}
			}
		case "trace":
			if f.Trace.Step == "rewriting" && f.Trace.Status == "end" {
				t.Logf("queries %v", f.Trace.Detail["queries"])
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
	t.Logf("first_token_ms=%d total_ms=%d", firstTok.Milliseconds(), time.Since(t0).Milliseconds())
	t.Logf("raw sources: %d, ranked: %d, report chars: %d", rawN, rankedN, chars)
	t.Logf("http started=%d done=%d canceled=%d failed=%d", s, d, c, fl)
}

// liveReport runs one query and returns the report text, ranked sources and done frame.
func liveReport(t *testing.T, query string) (string, []contract.SourceCard, *contract.DonePayload, int, []string) {
	t.Helper()
	loadBackendEnv(t)
	deps := NewDeps(config.Load())
	var report strings.Builder
	var ranked []contract.SourceCard
	var done *contract.DonePayload
	var related []string
	var traceDegraded []string
	req := contract.SearchRequest{Query: query, FocusMode: "web", Engine: "tavily", ScopeFilters: []string{}}
	err := pipeline.Run(context.Background(), deps, req, func(f contract.StreamFrame) error {
		switch f.Type {
		case "token":
			report.WriteString(f.Token.Delta)
		case "sources":
			if f.Sources.Phase == "ranked" {
				ranked = f.Sources.Ranked
			}
		case "related":
			related = f.Related.Items
		case "trace":
			if f.Trace.Status == "degraded" {
				traceDegraded = append(traceDegraded, f.Trace.Message)
			}
		case "done":
			done = f.Done
		case "error":
			t.Errorf("error frame: %+v", *f.Error)
		}
		return nil
	})
	if err != nil || done == nil {
		t.Fatalf("Run err=%v done=%v", err, done != nil)
	}
	return report.String(), ranked, done, len(related), traceDegraded
}

func TestLiveDoneFrame(t *testing.T) {
	report, ranked, done, relatedN, degraded := liveReport(t, liveQuery)
	u16 := utf16.Encode([]rune(report))
	badMarker, withHL := 0, 0
	for _, c := range done.Citations {
		if got := string(utf16.Decode(u16[c.MarkerStart:c.MarkerEnd])); got != fmt.Sprintf("[%d]", c.Index) {
			badMarker++
		}
		if c.Highlight != nil {
			withHL++
		}
	}
	t.Logf("marker slice mismatches=%d, citations with highlight=%d/%d", badMarker, withHL, len(done.Citations))
	cons := "null"
	if done.Consensus != nil && done.Consensus.Score != nil {
		cons = fmt.Sprintf("score=%.4f supported=%d cited=%d", *done.Consensus.Score, done.Consensus.SupportedSentences, done.Consensus.CitedSentences)
	}
	t.Logf("citations=%d", len(done.Citations))
	t.Logf("consensus=%s", cons)
	t.Logf("takeaways=%d related=%d", len(done.Takeaways), relatedN)
	t.Logf("degraded traces=%q", degraded)
	t.Logf("finalizingMs=%d", done.StageTimings.FinalizingMs)
	for _, tk := range done.Takeaways {
		t.Logf("takeaway %q cites %v", tk.Text, tk.Citations)
	}
	shown := 0
	for _, s := range ranked {
		if s.BibTeX != nil && shown < 2 {
			t.Logf("bibtex for %s:\n%s", s.URL, *s.BibTeX)
			shown++
		}
	}
	if shown == 0 {
		t.Logf("no preprint bibtex in this ranking")
	}
}

func TestLiveEvalFence(t *testing.T) {
	report, _, done, _, degraded := liveReport(t, "H100 与 H200 显存带宽与算力参数对比")
	open := strings.Count(report, "```openui-lang")
	closed := 0
	inFence := false
	for _, ln := range strings.Split(report, "\n") {
		t := strings.TrimSpace(ln)
		if !inFence && strings.HasPrefix(t, "```openui-lang") {
			inFence = true
		} else if inFence && t == "```" {
			inFence = false
			closed++
		}
	}
	t.Logf("openui-lang fences opened=%d closed=%d unclosed_tail=%v", open, closed, inFence)
	t.Logf("citations=%d degraded=%q", len(done.Citations), degraded)
	if open == 0 {
		t.Errorf("no openui-lang fence in the report")
	}
	if inFence {
		t.Errorf("unclosed openui-lang fence survived")
	}
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
