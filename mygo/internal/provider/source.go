// Package provider holds the external clients (Tavily, DeepSeek search, LLM
// chat completions) and the URL / passage helpers they share. Behavior follows
// backend/app/pipeline/providers and docs/接口设计.md §4.
package provider

import (
	"context"
	"errors"
	"fmt"
)

// Source is the internal search hit. It carries the raw engine signals the
// ranker needs; only a subset is sent to the page.
type Source struct {
	ID             string
	Title          string
	URL            string // display URL: fragment stripped
	Domain         string
	FaviconURL     *string
	Engine         string // tavily | deepseek
	Category       string
	CategorySource string
	PublishedAt    *string // ISO 8601 UTC

	RawScore        *float64 // tavily score
	RerankScore     *float64 // deepseek rerank_score
	AuthoritySignal *float64 // deepseek authority; nil when unknown (-1)
	Summary         string   // passage material (deepseek)
	Content         string   // passage material (tavily)
	MatchedQueries  []int
}

// Provider is one search engine.
type Provider interface {
	Name() string
	// Search runs one query. exclude lists categories to keep out (L1/L2 filter).
	Search(ctx context.Context, query string, count int, exclude []string) ([]Source, error)
}

// ErrTimeout marks an idle/first-token timeout enforced by this package.
var ErrTimeout = errors.New("timeout")

// Error is a failed upstream call. It never carries credentials: the message is
// built from the upstream name and HTTP status only.
type Error struct {
	Upstream string // llm | tavily | deepseek_search
	Status   int    // 0 when no HTTP response
	Err      error
}

func (e *Error) Error() string {
	if e.Status != 0 {
		return fmt.Sprintf("%s: HTTP %d", e.Upstream, e.Status)
	}
	if e.Err != nil {
		return fmt.Sprintf("%s: %v", e.Upstream, e.Err)
	}
	return e.Upstream + ": failed"
}

func (e *Error) Unwrap() error { return e.Err }

// newSource builds the fields every engine fills the same way.
func newSource(rawURL, title, engine string) Source {
	domain := ExtractDomain(rawURL)
	cat, _ := Classify(domain)
	return Source{
		ID:             StableID(rawURL),
		Title:          title,
		URL:            DisplayURL(rawURL),
		Domain:         domain,
		Engine:         engine,
		Category:       cat,
		CategorySource: "rule",
	}
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
