package provider

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/lhmile489-design/mile-ai-search/internal/config"
)

// LLM is an OpenAI-compatible chat-completions client (DeepSeek by default).
// Thinking is always disabled, as measured in backend/docs/外部依赖实测.md P1.
type LLM struct {
	Client  *http.Client
	BaseURL string
	Key     config.Secret
	Model   string
}

func (l *LLM) endpoint() string {
	return strings.TrimRight(l.BaseURL, "/") + "/chat/completions"
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type thinking struct {
	Type string `json:"type"`
}

type chatRequest struct {
	Model         string         `json:"model"`
	Messages      []chatMessage  `json:"messages"`
	Thinking      thinking       `json:"thinking"`
	MaxTokens     int            `json:"max_tokens"`
	Stream        bool           `json:"stream"`
	StreamOptions map[string]any `json:"stream_options,omitempty"`
}

func (l *LLM) request(system, user string, maxTokens int, stream bool) chatRequest {
	r := chatRequest{
		Model: l.Model,
		Messages: []chatMessage{
			{Role: "system", Content: system},
			{Role: "user", Content: user},
		},
		Thinking:  thinking{Type: "disabled"},
		MaxTokens: maxTokens,
		Stream:    stream,
	}
	if stream {
		r.StreamOptions = map[string]any{"include_usage": true}
	}
	return r
}

// Complete runs one non-streaming completion and returns the message content.
// The caller bounds it with a context deadline (rewrite uses 15 s).
func (l *LLM) Complete(ctx context.Context, system, user string, maxTokens int) (string, error) {
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := postJSON(ctx, l.Client, l.endpoint(), l.Key, "llm", l.request(system, user, maxTokens, false), &out); err != nil {
		return "", err
	}
	if len(out.Choices) == 0 {
		return "", &Error{Upstream: "llm", Err: errors.New("empty choices")}
	}
	return out.Choices[0].Message.Content, nil
}

// Usage is the token accounting the final chunk carries.
type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
	CachedTokens     int `json:"prompt_cache_hit_tokens"`
}

// StreamResult summarizes a finished stream.
type StreamResult struct {
	Usage        *Usage
	FirstTokenMs int64 // -1 when no token arrived
	Chunks       int
}

// Stream calls the streaming endpoint and hands every non-empty content delta
// to onToken. Empty deltas are skipped (the first chunk is role-only), so the
// first-token clock starts at real text. If no token arrives within firstToken
// the call is canceled and ErrTimeout is returned. A canceled ctx aborts the
// read and the request, which the HTTP stats record as canceled.
func (l *LLM) Stream(ctx context.Context, system, user string, maxTokens int, firstToken time.Duration, onToken func(string) error) (StreamResult, error) {
	res := StreamResult{FirstTokenMs: -1}
	body, err := json.Marshal(l.request(system, user, maxTokens, true))
	if err != nil {
		return res, &Error{Upstream: "llm", Err: err}
	}

	rctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var timedOut atomic.Bool
	timer := time.AfterFunc(firstToken, func() { timedOut.Store(true); cancel() })
	defer timer.Stop()

	req, err := http.NewRequestWithContext(rctx, http.MethodPost, l.endpoint(), bytes.NewReader(body))
	if err != nil {
		return res, &Error{Upstream: "llm", Err: err}
	}
	req.Header.Set("Authorization", "Bearer "+l.Key.Reveal())
	req.Header.Set("Content-Type", "application/json")

	start := time.Now()
	fail := func(err error) (StreamResult, error) {
		if timedOut.Load() && res.FirstTokenMs < 0 {
			return res, &Error{Upstream: "llm", Err: ErrTimeout}
		}
		if ctx.Err() != nil {
			return res, ctx.Err()
		}
		return res, &Error{Upstream: "llm", Err: err}
	}

	resp, err := l.Client.Do(req)
	if err != nil {
		return fail(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return res, &Error{Upstream: "llm", Status: resp.StatusCode}
	}

	rd := bufio.NewReaderSize(resp.Body, 64*1024)
	for {
		line, err := rd.ReadString('\n')
		if line = strings.TrimSpace(line); strings.HasPrefix(line, "data:") {
			data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			if data == "[DONE]" {
				return res, nil
			}
			var chunk struct {
				Usage   *Usage `json:"usage"`
				Choices []struct {
					Delta struct {
						Content string `json:"content"`
					} `json:"delta"`
				} `json:"choices"`
			}
			if json.Unmarshal([]byte(data), &chunk) == nil {
				if chunk.Usage != nil {
					res.Usage = chunk.Usage
				}
				if len(chunk.Choices) > 0 && chunk.Choices[0].Delta.Content != "" {
					if res.FirstTokenMs < 0 {
						res.FirstTokenMs = time.Since(start).Milliseconds()
						timer.Stop()
					}
					res.Chunks++
					if cbErr := onToken(chunk.Choices[0].Delta.Content); cbErr != nil {
						return res, cbErr
					}
				}
			}
		}
		if err != nil {
			if err == io.EOF {
				return res, nil
			}
			return fail(err)
		}
	}
}
