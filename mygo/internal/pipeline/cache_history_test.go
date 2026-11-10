package pipeline

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lhmile489-design/mile-ai-search/internal/cache"
	"github.com/lhmile489-design/mile-ai-search/internal/contract"
	"github.com/lhmile489-design/mile-ai-search/internal/history"
)

var cacheReq = contract.SearchRequest{Query: "cache me", FocusMode: "web", Engine: "tavily"}

func newCache(enabled bool, ttl time.Duration, now func() time.Time) *CacheStore {
	return cache.NewStore[L1Entry, *Snapshot](enabled, 16, ttl, now)
}

func doneOf(frames []contract.StreamFrame) *contract.DonePayload {
	return frames[len(frames)-1].Done
}

func TestSecondRunIsCacheHitWithMeasuredTimings(t *testing.T) {
	llm := fakeLLM(t, `["q one","q two"]`, []string{"Hello ", "world [1]."})
	defer llm.Close()
	tav := fakeTavily(t, false)
	defer tav.Close()
	d := newDeps(llm.URL, tav.URL)
	d.Cache = newCache(true, time.Minute, nil)

	first := doneOf(collect(t, d, cacheReq))
	if first.CacheHit {
		t.Fatal("first run must not be a cache hit")
	}
	time.Sleep(15 * time.Millisecond)
	frames := collect(t, d, cacheReq)
	second := doneOf(frames)
	if !second.CacheHit {
		t.Fatal("second run must be a cache hit")
	}
	if second.LatencyMs == first.LatencyMs && second.StageTimings == first.StageTimings {
		t.Fatalf("replay reused the old timings: %+v", second.StageTimings)
	}
	var tokens int
	for _, f := range frames {
		if f.Type == "trace" && !f.Trace.CacheHit {
			t.Errorf("replayed trace without cacheHit: %+v", f.Trace)
		}
		if f.Type == "token" {
			tokens++
		}
	}
	if tokens == 0 {
		t.Fatal("replay sent no token frames")
	}
}

func TestL1HitKeepsRealEngineAndDoesNotDegrade(t *testing.T) {
	llm := fakeLLM(t, `["q one"]`, []string{"Hi [1]."})
	defer llm.Close()
	tav := fakeTavily(t, false)
	defer tav.Close()
	d := newDeps(llm.URL, tav.URL)
	d.Cache = newCache(true, time.Minute, nil)
	collect(t, d, cacheReq)

	// Same sub-queries, different question: L2 misses, L1 hits.
	req := cacheReq
	req.Query = "another question"
	frames := collect(t, d, req)
	var sawHit bool
	for _, f := range frames {
		switch {
		case f.Type == "sources" && f.Sources.Phase == "raw":
			if strings.ContainsAny(f.Sources.Engine, "()") || f.Sources.Engine != "tavily" {
				t.Errorf("engine=%q, want plain tavily", f.Sources.Engine)
			}
		case f.Type == "trace":
			if f.Trace.Status == "degraded" {
				t.Errorf("L1 hit triggered degraded: %+v", f.Trace)
			}
			if f.Trace.Step == "searching" && f.Trace.Status == "end" && f.Trace.CacheHit {
				sawHit = true
			}
		}
	}
	if !sawHit {
		t.Fatal("searching end trace did not report cacheHit")
	}
	if doneOf(frames).Degraded {
		t.Fatal("done.degraded set by an L1 hit")
	}
}

func TestTTLExpiryRecomputes(t *testing.T) {
	llm := fakeLLM(t, `["q one"]`, []string{"Hi [1]."})
	defer llm.Close()
	tav := fakeTavily(t, false)
	defer tav.Close()
	var mu sync.Mutex
	clock := time.Now()
	now := func() time.Time { mu.Lock(); defer mu.Unlock(); return clock }
	d := newDeps(llm.URL, tav.URL)
	d.Cache = newCache(true, 10*time.Second, now)

	collect(t, d, cacheReq)
	mu.Lock()
	clock = clock.Add(11 * time.Second)
	mu.Unlock()
	if doneOf(collect(t, d, cacheReq)).CacheHit {
		t.Fatal("expired entry still served")
	}
}

func TestCacheDisabledNeverCaches(t *testing.T) {
	llm := fakeLLM(t, `["q one"]`, []string{"Hi [1]."})
	defer llm.Close()
	tav := fakeTavily(t, false)
	defer tav.Close()
	d := newDeps(llm.URL, tav.URL)
	d.Cache = newCache(false, time.Minute, nil)
	collect(t, d, cacheReq)
	if doneOf(collect(t, d, cacheReq)).CacheHit {
		t.Fatal("cache disabled but second run hit")
	}
}

func TestErrorRunIsNotCached(t *testing.T) {
	llm := fakeLLM(t, `["q one"]`, []string{"Hi"})
	defer llm.Close()
	tav := fakeTavily(t, true)
	defer tav.Close()
	d := newDeps(llm.URL, tav.URL)
	d.Cache = newCache(true, time.Minute, nil)
	collect(t, d, cacheReq)
	if _, hit := d.Cache.GetL2(cache.L2Key(cacheReq.Query, cacheReq.FocusMode, cacheReq.Engine, nil)); hit {
		t.Fatal("failed run was cached in L2")
	}
}

func TestReplayCancelStops(t *testing.T) {
	llm := fakeLLM(t, `["q one"]`, []string{strings.Repeat("x", 400) + " [1]."})
	defer llm.Close()
	tav := fakeTavily(t, false)
	defer tav.Close()
	d := newDeps(llm.URL, tav.URL)
	d.Cache = newCache(true, time.Minute, nil)
	collect(t, d, cacheReq)

	ctx, cancel := context.WithCancel(context.Background())
	var tokens int
	err := Run(ctx, d, cacheReq, func(f contract.StreamFrame) error {
		if f.Type == "token" {
			tokens++
			cancel()
		}
		return nil
	})
	if err == nil || tokens != 1 {
		t.Fatalf("err=%v tokens=%d, want cancellation after the first chunk", err, tokens)
	}
}

func openStore(t *testing.T) *history.Store {
	t.Helper()
	s, err := history.Open(filepath.Join(t.TempDir(), "data", "h.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestHistoryRowsForFreshAndReplay(t *testing.T) {
	llm := fakeLLM(t, `["q one","q two"]`, []string{"Hello ", "world [1]."})
	defer llm.Close()
	tav := fakeTavily(t, false)
	defer tav.Close()
	d := newDeps(llm.URL, tav.URL)
	d.Cache = newCache(true, time.Minute, nil)
	st := openStore(t)
	d.History = st

	d1 := doneOf(collect(t, d, cacheReq))
	d2 := doneOf(collect(t, d, cacheReq))
	if d1.HistoryID == nil || d2.HistoryID == nil || *d1.HistoryID == *d2.HistoryID {
		t.Fatalf("history ids: %v %v", d1.HistoryID, d2.HistoryID)
	}
	r1, err := st.Get(context.Background(), *d1.HistoryID)
	if err != nil {
		t.Fatal(err)
	}
	if r1.CacheHit || r1.ReportText != "Hello world [1]." || r1.SourceCount != 2 || r1.Query != cacheReq.Query {
		t.Fatalf("fresh row: %+v", r1)
	}
	r2, err := st.Get(context.Background(), *d2.HistoryID)
	if err != nil {
		t.Fatal(err)
	}
	if !r2.CacheHit {
		t.Fatal("replay row must have cache_hit=1")
	}
	var traces []contract.TracePayload
	if err := json.Unmarshal([]byte(r2.TraceEvents), &traces); err != nil || len(traces) == 0 {
		t.Fatalf("replay trace_events not a non-empty JSON array: %v %q", err, r2.TraceEvents)
	}
	for _, tr := range traces {
		if !tr.CacheHit {
			t.Errorf("stored replay trace without cacheHit: %+v", tr)
		}
	}
	if r2.ReportText != r1.ReportText {
		t.Fatal("replay row lost the report")
	}
}

type failingWriter struct{}

func (failingWriter) Insert(context.Context, history.Record) error {
	return errors.New("disk full")
}

func TestHistoryWriteFailureDoesNotBreakResponseAndIsLogged(t *testing.T) {
	llm := fakeLLM(t, `["q one"]`, []string{"Hi [1]."})
	defer llm.Close()
	tav := fakeTavily(t, false)
	defer tav.Close()
	d := newDeps(llm.URL, tav.URL)
	d.History = failingWriter{}

	var buf bytes.Buffer
	log.SetOutput(&buf)
	defer log.SetOutput(os.Stderr)

	frames := collect(t, d, cacheReq)
	done := doneOf(frames)
	if frames[len(frames)-1].Type != "done" || done.HistoryID != nil {
		t.Fatalf("want done with nil historyId, got %+v", frames[len(frames)-1])
	}
	out := buf.String()
	if !strings.Contains(out, "level=error") || !strings.Contains(out, "disk full") || !strings.Contains(out, "errors.errorString") {
		t.Fatalf("error log must carry level, error type and text, got: %s", out)
	}
}
