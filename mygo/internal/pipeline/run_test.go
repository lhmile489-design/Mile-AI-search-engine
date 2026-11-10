package pipeline

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lhmile489-design/mile-ai-search/internal/config"
	"github.com/lhmile489-design/mile-ai-search/internal/contract"
	"github.com/lhmile489-design/mile-ai-search/internal/provider"
)

func TestParseQueries(t *testing.T) {
	cases := []struct {
		in   string
		want int
	}{
		{`["a","b","c"]`, 3},
		{"text before [\"a\", \"b\"] after", 2},
		{`["a","b","c","d","e","f","g"]`, 5},
		{`["  ", "x"]`, 1},
		{`not json`, 0},
		{`[1,2]`, 0},
	}
	for _, c := range cases {
		if got := ParseQueries(c.in); len(got) != c.want {
			t.Errorf("ParseQueries(%q) = %v, want %d items", c.in, got, c.want)
		}
	}
}

// fakeLLM serves the non-stream rewrite call and the SSE report stream.
// finalizeTestBody is what the fake LLM answers to the finalize call.
const finalizeTestBody = `{"takeaways":[{"text":"a","citations":[1]},{"text":"b","citations":[2]},{"text":"c","citations":[1,2]}],"followUps":["q1","q2","q3"]}`

func fakeLLM(t *testing.T, rewriteBody string, tokens []string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Stream   bool `json:"stream"`
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		if !req.Stream {
			body := rewriteBody
			if len(req.Messages) > 0 && strings.Contains(req.Messages[0].Content, "takeaways") {
				body = finalizeTestBody // the finalize call, not the rewrite call
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"choices": []any{map[string]any{"message": map[string]any{"content": body}}},
			})
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fl := w.(http.Flusher)
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\",\"content\":\"\"}}]}\n\n")
		for _, tk := range tokens {
			b, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"delta": map[string]any{"content": tk}}}})
			fmt.Fprintf(w, "data: %s\n\n", b)
			fl.Flush()
		}
		fmt.Fprint(w, "data: {\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":3,\"total_tokens\":13},\"choices\":[{\"delta\":{}}]}\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
}

func fakeTavily(t *testing.T, fail bool) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if fail {
			http.Error(w, "boom", http.StatusInternalServerError)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"results": []any{
			map[string]any{"title": "A", "url": "https://arxiv.org/abs/1", "content": "alpha", "score": 0.9, "published_date": "Mon, 02 Jan 2025 00:00:00 GMT"},
			map[string]any{"title": "B", "url": "https://github.com/x/y", "content": "beta", "score": 0.7},
		}})
	}))
}

func newDeps(llmURL, tavURL string) Deps {
	cfg := config.Defaults()
	cfg.LLMAPIKey = "k"
	cfg.LLMBaseURL = llmURL
	cfg.TavilyAPIKey = "k"
	hc := provider.NewHTTPClient(nil)
	return Deps{
		Cfg: cfg,
		LLM: &provider.LLM{Client: hc, BaseURL: llmURL, Key: "k", Model: "m"},
		Providers: func(string) (provider.Provider, provider.Provider, bool) {
			return &provider.Tavily{Key: "k", URL: tavURL, HTTP: hc}, nil, true
		},
	}
}

func collect(t *testing.T, d Deps, req contract.SearchRequest) []contract.StreamFrame {
	t.Helper()
	var mu sync.Mutex
	var frames []contract.StreamFrame
	err := Run(context.Background(), d, req, func(f contract.StreamFrame) error {
		mu.Lock()
		frames = append(frames, f)
		mu.Unlock()
		return nil
	})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	return frames
}

func TestFrameOrder(t *testing.T) {
	llm := fakeLLM(t, `["q one","q two"]`, []string{"Hello ", "world [1]."})
	defer llm.Close()
	tav := fakeTavily(t, false)
	defer tav.Close()

	frames := collect(t, newDeps(llm.URL, tav.URL), contract.SearchRequest{Query: "test", FocusMode: "web", Engine: "tavily"})

	var seq []string
	for _, f := range frames {
		switch f.Type {
		case "trace":
			seq = append(seq, f.Trace.Step+":"+f.Trace.Status)
		case "sources":
			seq = append(seq, "sources:"+f.Sources.Phase)
		default:
			seq = append(seq, f.Type)
		}
	}
	got := strings.Join(seq, " ")
	order := []string{
		"rewriting:start", "rewriting:end", "searching:start", "sources:raw", "sources:raw",
		"searching:end", "reasoning:start", "sources:ranked", "reasoning:end",
		"generating:start", "token", "token", "generating:end", "related", "done",
	}
	if got != strings.Join(order, " ") {
		t.Fatalf("frame order:\n got  %s\n want %s", got, strings.Join(order, " "))
	}
	last := frames[len(frames)-1].Done
	if last.SourceCount != 2 || last.CharCount != len("Hello world [1].") {
		t.Fatalf("done: %+v", last)
	}
	// The report cites source 1 once; the sentence has a single domain.
	if len(last.Citations) != 1 || last.Citations[0].Index != 1 {
		t.Fatalf("citations: %+v", last.Citations)
	}
	if last.Consensus == nil || last.Consensus.CitedSentences != 1 || last.Consensus.SupportedSentences != 0 {
		t.Fatalf("consensus: %+v", last.Consensus)
	}
}

func TestRewriteFallbackKeepsOriginalQuery(t *testing.T) {
	llm := fakeLLM(t, `garbage`, []string{"x"})
	defer llm.Close()
	tav := fakeTavily(t, false)
	defer tav.Close()
	frames := collect(t, newDeps(llm.URL, tav.URL), contract.SearchRequest{Query: "orig", FocusMode: "web", Engine: "tavily"})
	d := frames[1].Trace.Detail
	if d["fallback"] != true || d["fallbackCode"] != float64(50202) && d["fallbackCode"] != 50202 {
		t.Fatalf("rewrite detail: %v", d)
	}
	if qs, _ := d["queries"].([]string); len(qs) != 1 || qs[0] != "orig" {
		t.Fatalf("queries: %v", d["queries"])
	}
}

func TestAllSearchesFailGives50201(t *testing.T) {
	llm := fakeLLM(t, `["a"]`, nil)
	defer llm.Close()
	tav := fakeTavily(t, true)
	defer tav.Close()
	frames := collect(t, newDeps(llm.URL, tav.URL), contract.SearchRequest{Query: "q", FocusMode: "web", Engine: "tavily"})
	last := frames[len(frames)-1]
	if last.Type != "error" || last.Error.Code != 50201 || !last.Error.Retryable {
		t.Fatalf("last frame: %+v", last)
	}
}

func TestInvalidScopeIs40001(t *testing.T) {
	frames := collect(t, newDeps("http://x", "http://x"), contract.SearchRequest{Query: "q", FocusMode: "web", Engine: "tavily", ScopeFilters: []string{"bogus"}})
	if len(frames) != 1 || frames[0].Error == nil || frames[0].Error.Code != 40001 {
		t.Fatalf("frames: %+v", frames)
	}
}

// Canceling mid-flight must stop the pipeline and cancel the in-flight request.
func TestCancelStopsInFlightRequests(t *testing.T) {
	release := make(chan struct{})
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer slow.Close()
	defer close(release)
	llm := fakeLLM(t, `["a","b","c"]`, nil)
	defer llm.Close()

	var stats provider.Stats
	d := newDeps(llm.URL, slow.URL)
	hc := provider.NewHTTPClient(&stats)
	d.Providers = func(string) (provider.Provider, provider.Provider, bool) {
		return &provider.Tavily{Key: "k", URL: slow.URL, HTTP: hc}, nil, true
	}
	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(300*time.Millisecond, cancel)
	err := Run(ctx, d, contract.SearchRequest{Query: "q", FocusMode: "web", Engine: "tavily"}, func(contract.StreamFrame) error { return nil })
	if err == nil {
		t.Fatal("expected ctx error after cancel")
	}
	time.Sleep(100 * time.Millisecond)
	started, done, canceled, _ := stats.Snapshot()
	if started != 3 || done != 0 || canceled != 3 {
		t.Fatalf("started=%d done=%d canceled=%d, want 3/0/3", started, done, canceled)
	}
}
