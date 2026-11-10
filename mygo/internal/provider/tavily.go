package provider

import (
	"context"
	"net/http"
	"net/mail"
	"time"

	"github.com/lhmile489-design/mile-ai-search/internal/config"
)

// TavilyURL is the search endpoint (backend/docs/外部依赖实测.md P3).
const TavilyURL = "https://api.tavily.com/search"

// Tavily is the Tavily Search client.
type Tavily struct {
	Key  config.Secret
	URL  string // overridable for tests; empty = TavilyURL
	HTTP *http.Client
}

func (t *Tavily) Name() string { return "tavily" }

type tavilyItem struct {
	Title         string   `json:"title"`
	URL           string   `json:"url"`
	Content       string   `json:"content"`
	Score         *float64 `json:"score"`
	PublishedDate string   `json:"published_date"`
	Favicon       string   `json:"favicon"`
}

// Search mirrors tavily.py: advanced depth, published date and favicon on,
// category exclusion via exclude_domains.
func (t *Tavily) Search(ctx context.Context, query string, count int, exclude []string) ([]Source, error) {
	var excludeDomains []string
	for _, cat := range exclude {
		excludeDomains = append(excludeDomains, CategoryDomains[cat]...)
	}
	payload := map[string]any{
		"query":                  query,
		"max_results":            count,
		"include_raw_content":    false,
		"include_published_date": true, // M0: without it there is no published_date key
		"include_favicon":        true,
		"search_depth":           "advanced",
	}
	if len(excludeDomains) > 0 {
		payload["exclude_domains"] = excludeDomains
	}

	endpoint := t.URL
	if endpoint == "" {
		endpoint = TavilyURL
	}
	var data struct {
		Results []tavilyItem `json:"results"`
	}
	if err := postJSON(ctx, t.HTTP, endpoint, t.Key, "tavily", payload, &data); err != nil {
		return nil, err
	}

	out := make([]Source, 0, len(data.Results))
	for _, it := range data.Results {
		s := newSource(it.URL, it.Title, "tavily")
		s.FaviconURL = strPtr(it.Favicon)
		s.PublishedAt = parseRFC1123(it.PublishedDate)
		s.RawScore = it.Score
		s.Content = it.Content
		out = append(out, s)
	}
	return out, nil
}

// parseRFC1123 converts an RFC 1123 date to ISO 8601 UTC (§4.3); nil on failure.
func parseRFC1123(v string) *string {
	if v == "" {
		return nil
	}
	dt, err := mail.ParseDate(v)
	if err != nil {
		return nil
	}
	s := dt.UTC().Format("2006-01-02T15:04:05Z")
	return &s
}

// parseISODate converts an RFC 3339 (or date-only) value to ISO 8601 UTC.
func parseISODate(v string) *string {
	if v == "" {
		return nil
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02T15:04:05", "2006-01-02"} {
		if dt, err := time.Parse(layout, v); err == nil {
			s := dt.UTC().Format("2006-01-02T15:04:05Z")
			return &s
		}
	}
	return nil
}
