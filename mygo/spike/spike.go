// Package spike holds G1 technical-probe bindings. They are not part of the
// app's services; they exist to verify mygo's Channel streaming, cancellation,
// and backpressure with real timing numbers before the pipeline is built on
// them. The Spike service is bound in main.go for the duration of G1 only.
package spike

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/http/httptrace"
	"os"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// Tick is one small stream frame, like a report token.
type Tick struct {
	Seq  int    `json:"seq"`
	Body string `json:"body"`
}

// BurstResult summarizes a burst run.
type BurstResult struct {
	Sent      int   `json:"sent"`
	Millis    int64 `json:"millis"`
	SendErr   bool  `json:"sendErr"`
	FirstNano int64 `json:"firstNano"`
}

// Spike is the probe service bound for G1.
type Spike struct{}

// ---- StreamFrame candidate encodings (G1 task 2) ----

// StreamFrameA is the single-struct-with-discriminator form: a Type tag plus
// every payload field optional (omitempty). The page narrows on .type.
type StreamFrameA struct {
	Type     string    `json:"type"`              // trace|sources|token|related|done|error
	Trace    *TracePay `json:"trace,omitempty"`   // for type=trace
	Sources  []Source  `json:"sources,omitempty"` // for type=sources
	Token    string    `json:"token,omitempty"`   // for type=token
	Related  []string  `json:"related,omitempty"` // for type=related
	Done     *DonePay  `json:"done,omitempty"`    // for type=done
	ErrorMsg string    `json:"error,omitempty"`   // for type=error
}

type TracePay struct {
	Stage  string `json:"stage"`
	Status string `json:"status"`
	Millis int64  `json:"millis"`
}

type Source struct {
	Title string `json:"title"`
	URL   string `json:"url"`
	Score int    `json:"score"`
}

type DonePay struct {
	Citations int    `json:"citations"`
	Consensus string `json:"consensus"`
}

// EchoA round-trips a StreamFrameA so the page can check the encoding.
func (Spike) EchoA(f StreamFrameA) StreamFrameA { return f }

// StreamFrameB is the "union" attempt: a Type tag plus a single Payload held
// as `any`. It is what a Go interface/union would lower to.
type StreamFrameB struct {
	Type    string `json:"type"`
	Payload any    `json:"payload,omitempty"`
}

// EchoB round-trips a StreamFrameB.
func (Spike) EchoB(f StreamFrameB) StreamFrameB { return f }

// ---- Task 3/4: real external calls ----

// TavilyResult is one parsed search hit.
type TavilyResult struct {
	Title         string  `json:"title"`
	URL           string  `json:"url"`
	Content       string  `json:"content"`
	Score         float64 `json:"score"`
	PublishedDate string  `json:"published_date"`
}

// Tavily runs one real Tavily /search request for query, honoring ctx.
// It parses the documented fields and reports request lifecycle via httptrace.
func (Spike) Tavily(ctx context.Context, query string) ([]TavilyResult, error) {
	key := os.Getenv("TAVILY_API_KEY")
	if key == "" {
		return nil, fmt.Errorf("TAVILY_API_KEY not set")
	}
	body, _ := json.Marshal(map[string]any{
		"query": query, "max_results": 3,
		"include_published_date": true, "search_depth": "basic",
	})
	req, err := http.NewRequestWithContext(ctx, "POST",
		"https://api.tavily.com/search", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	trace := &httptrace.ClientTrace{
		GotConn:  func(httptrace.GotConnInfo) { log.Printf("[tavily:%s] conn acquired", query) },
		DNSStart: func(httptrace.DNSStartInfo) { log.Printf("[tavily:%s] dns start", query) },
	}
	req = req.WithContext(httptrace.WithClientTrace(req.Context(), trace))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("[tavily:%s] request failed: %v", query, err)
		return nil, err
	}
	defer resp.Body.Close()
	var parsed struct {
		Results []TavilyResult `json:"results"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, err
	}
	log.Printf("[tavily:%s] done: %d results, status %d", query, len(parsed.Results), resp.StatusCode)
	return parsed.Results, nil
}

// TavilyBurst fires n concurrent Tavily searches derived from ctx, streams each
// completion as a frame, and logs cancellations. The page cancels mid-flight.
func (Spike) TavilyBurst(ctx context.Context, n int, ch *mygo.Channel[TavilyResult]) error {
	key := os.Getenv("TAVILY_API_KEY")
	if key == "" {
		return fmt.Errorf("TAVILY_API_KEY not set")
	}
	var wg sync.WaitGroup
	var started, done, canceled int32
	var mu sync.Mutex
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			q := fmt.Sprintf("probe query %d", i)
			mu.Lock()
			started++
			mu.Unlock()
			res, err := (Spike{}).Tavily(ctx, q)
			if err != nil {
				mu.Lock()
				canceled++
				mu.Unlock()
				log.Printf("[burst] q%d canceled/failed: %v", i, err)
				return
			}
			mu.Lock()
			done++
			mu.Unlock()
			if len(res) > 0 {
				_ = ch.Send(res[0]) // ignore send err if page closed
			}
		}(i)
	}
	wg.Wait()
	log.Printf("[burst] finished: started=%d done=%d canceled=%d", started, done, canceled)
	return nil
}

// ---- Task 4.2: LLM streaming (DeepSeek chat completions, OpenAI-compatible SSE) ----

// LLMToken is one streamed token frame.
type LLMToken struct {
	Delta string `json:"delta"`
	Seq   int    `json:"seq"`
}

// LLMStats reports first-token latency and totals for the stream.
type LLMStats struct {
	FirstTokenMs int64 `json:"firstTokenMs"`
	TotalMs      int64 `json:"totalMs"`
	Chunks       int   `json:"chunks"`
	Chars        int   `json:"chars"`
}

// LLMStream calls the chat-completions streaming endpoint and pushes each
// content delta through ch. It returns first-token and total latency. Honors
// ctx for cancellation; a page break stops the upstream read.
func (Spike) LLMStream(ctx context.Context, prompt string, ch *mygo.Channel[LLMToken]) (LLMStats, error) {
	base := os.Getenv("LLM_BASE_URL")
	key := os.Getenv("LLM_API_KEY")
	model := os.Getenv("LLM_MODEL")
	if base == "" || key == "" {
		return LLMStats{}, fmt.Errorf("LLM_BASE_URL or LLM_API_KEY not set")
	}
	if model == "" {
		model = "deepseek-flash"
	}
	stats := LLMStats{}
	start := time.Now()

	reqBody, _ := json.Marshal(map[string]any{
		"model": model, "stream": true,
		"thinking": map[string]any{"type": "disabled"},
		"messages": []map[string]string{{"role": "user", "content": prompt}},
	})
	req, err := http.NewRequestWithContext(ctx, "POST",
		base+"/chat/completions", bytes.NewReader(reqBody))
	if err != nil {
		return stats, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return stats, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return stats, fmt.Errorf("llm status %d", resp.StatusCode)
	}

	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	seq := 0
	firstLogged := false
	for sc.Scan() {
		line := sc.Text()
		if len(line) < 6 || line[:6] != "data: " {
			continue
		}
		payload := line[6:]
		if payload == "[DONE]" {
			break
		}
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if json.Unmarshal([]byte(payload), &chunk) != nil || len(chunk.Choices) == 0 {
			continue
		}
		delta := chunk.Choices[0].Delta.Content
		if delta == "" {
			continue
		}
		if !firstLogged {
			stats.FirstTokenMs = time.Since(start).Milliseconds()
			firstLogged = true
		}
		stats.Chunks++
		stats.Chars += len(delta)
		if err := ch.Send(LLMToken{Delta: delta, Seq: seq}); err != nil {
			stats.TotalMs = time.Since(start).Milliseconds()
			return stats, err
		}
		seq++
	}
	if err := sc.Err(); err != nil {
		stats.TotalMs = time.Since(start).Milliseconds()
		return stats, err
	}
	stats.TotalMs = time.Since(start).Milliseconds()
	log.Printf("[llm] stream done: firstToken=%dms total=%dms chunks=%d chars=%d",
		stats.FirstTokenMs, stats.TotalMs, stats.Chunks, stats.Chars)
	return stats, nil
}

// SendA pushes one of each StreamFrameA variant through a channel.
func (Spike) SendA(ch *mygo.Channel[StreamFrameA]) error {
	frames := []StreamFrameA{
		{Type: "trace", Trace: &TracePay{Stage: "rewrite", Status: "done", Millis: 42}},
		{Type: "sources", Sources: []Source{{Title: "t", URL: "u", Score: 3}}},
		{Type: "token", Token: "hello"},
		{Type: "related", Related: []string{"q1", "q2"}},
		{Type: "done", Done: &DonePay{Citations: 5, Consensus: "high"}},
		{Type: "error", ErrorMsg: "boom"},
	}
	for _, f := range frames {
		if err := ch.Send(f); err != nil {
			return err
		}
	}
	return nil
}

// Report receives a JSON result line from the page and logs it, so probe
// outcomes land in the dev log where they can be read as evidence.
func (Spike) Report(line string) error {
	log.Printf("[spike:page] %s", line)
	return nil
}

// Burst sends n small frames as fast as interval allows, measuring latency.
// The page reads them with `for await` and reports drops / reordering.
func (Spike) Burst(ctx context.Context, n int, intervalMs int, ch *mygo.Channel[Tick]) BurstResult {
	res := BurstResult{Sent: 0}
	start := time.Now()
	for i := 0; i < n; i++ {
		if err := ctx.Err(); err != nil {
			res.SendErr = true
			res.Millis = time.Since(start).Milliseconds()
			return res
		}
		if i == 0 {
			res.FirstNano = time.Since(start).Nanoseconds()
		}
		err := ch.Send(Tick{Seq: i, Body: fmt.Sprintf("frame-%d", i)})
		if err != nil {
			res.SendErr = true
			res.Millis = time.Since(start).Milliseconds()
			return res
		}
		res.Sent++
		if intervalMs > 0 {
			time.Sleep(time.Duration(intervalMs) * time.Millisecond)
		}
	}
	res.Millis = time.Since(start).Milliseconds()
	return res
}

// Slow sends one frame per second until the page cancels (break / close),
// proving Send fails and ctx is canceled. The Go log records how many were
// sent; the error rejects the page's call promise.
func (Spike) Slow(ctx context.Context, ch *mygo.Channel[Tick]) error {
	for i := 0; ; i++ {
		select {
		case <-ctx.Done():
			log.Printf("[spike] Slow ctx canceled after %d sends: %v", i, ctx.Err())
			return ctx.Err()
		case <-time.After(time.Second):
		}
		if err := ch.Send(Tick{Seq: i, Body: fmt.Sprintf("slow-%d", i)}); err != nil {
			log.Printf("[spike] Slow Send failed after %d sends: %v", i, err)
			return err
		}
	}
}

// Flow sends many large frames to drive the page over the 1 MiB window so the
// backpressure path in channel.send actually engages.
func (Spike) Flow(ctx context.Context, frames int, ch *mygo.Channel[Tick]) error {
	// ~256 KiB body so ~5 frames fill the 1 MiB window quickly.
	b := make([]byte, 256*1024)
	for i := range b {
		b[i] = byte('a' + i%26)
	}
	payload := string(b)
	for i := 0; i < frames; i++ {
		if err := ctx.Err(); err != nil {
			log.Printf("[spike] Flow ctx canceled at frame %d: %v", i, err)
			return err
		}
		if err := ch.Send(Tick{Seq: i, Body: payload}); err != nil {
			log.Printf("[spike] Flow Send failed at frame %d: %v", i, err)
			return err
		}
	}
	log.Printf("[spike] Flow sent all %d frames", frames)
	return nil
}
