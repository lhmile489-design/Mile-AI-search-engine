package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptrace"
	"sync"
	"sync/atomic"

	"github.com/lhmile489-design/mile-ai-search/internal/config"
)

// Stats counts the lifecycle of every outbound HTTP request so cancellation is
// observable: after the caller disconnects, Canceled grows and Started stops.
type Stats struct {
	Started  atomic.Int64 // RoundTrip entered
	Wrote    atomic.Int64 // request fully written (httptrace WroteRequest)
	Done     atomic.Int64 // response body read to the end or closed normally
	Canceled atomic.Int64 // ended because the request context was canceled
	Failed   atomic.Int64 // ended with a non-cancellation error
}

// Snapshot returns started, done, canceled, failed.
func (s *Stats) Snapshot() (started, done, canceled, failed int64) {
	return s.Started.Load(), s.Done.Load(), s.Canceled.Load(), s.Failed.Load()
}

type tracedTransport struct {
	base  http.RoundTripper
	stats *Stats
}

// NewHTTPClient returns a client that honors HTTP(S)_PROXY from the environment
// and records every request in stats. There is no client-wide timeout: callers
// bound each call with a context (streams must outlive any fixed timeout).
func NewHTTPClient(stats *Stats) *http.Client {
	if stats == nil {
		stats = &Stats{}
	}
	return &http.Client{Transport: &tracedTransport{base: http.DefaultTransport, stats: stats}}
}

func (t *tracedTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	t.stats.Started.Add(1)
	host := req.URL.Host
	log.Printf("[http] start %s %s", req.Method, host)
	trace := &httptrace.ClientTrace{
		WroteRequest: func(httptrace.WroteRequestInfo) { t.stats.Wrote.Add(1) },
	}
	req = req.WithContext(httptrace.WithClientTrace(req.Context(), trace))
	ctx := req.Context()

	resp, err := t.base.RoundTrip(req)
	if err != nil {
		t.end(ctx, host, err, false)
		return nil, err
	}
	resp.Body = &trackedBody{ReadCloser: resp.Body, t: t, ctx: ctx, host: host}
	return resp, nil
}

// end records the outcome exactly once per request (callers guard with Once).
func (t *tracedTransport) end(ctx context.Context, host string, err error, eof bool) {
	switch {
	case eof:
		t.stats.Done.Add(1)
		log.Printf("[http] done %s", host)
	case ctx.Err() != nil:
		t.stats.Canceled.Add(1)
		log.Printf("[http] canceled %s", host)
	case err != nil:
		t.stats.Failed.Add(1)
		log.Printf("[http] failed %s", host)
	default:
		t.stats.Done.Add(1)
		log.Printf("[http] done %s", host)
	}
}

type trackedBody struct {
	io.ReadCloser
	t    *tracedTransport
	ctx  context.Context
	host string
	once sync.Once
}

func (b *trackedBody) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	if err != nil {
		b.once.Do(func() { b.t.end(b.ctx, b.host, err, err == io.EOF) })
	}
	return n, err
}

func (b *trackedBody) Close() error {
	err := b.ReadCloser.Close()
	b.once.Do(func() { b.t.end(b.ctx, b.host, nil, false) })
	return err
}

// postJSON sends a JSON POST with Bearer auth and decodes a 2xx JSON response.
// The key is only placed in the header; errors never include it.
func postJSON(ctx context.Context, client *http.Client, endpoint string, key config.Secret, upstream string, payload, out any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return &Error{Upstream: upstream, Err: err}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return &Error{Upstream: upstream, Err: err}
	}
	req.Header.Set("Authorization", "Bearer "+key.Reveal())
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return &Error{Upstream: upstream, Err: err}
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return &Error{Upstream: upstream, Status: resp.StatusCode}
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return &Error{Upstream: upstream, Err: err}
	}
	return nil
}
