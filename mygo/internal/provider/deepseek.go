package provider

import (
	"context"
	"net/http"
	"sort"
	"strings"

	"github.com/lhmile489-design/mile-ai-search/internal/config"
)

// DeepSeekSearchURL is the search endpoint (backend/docs/外部依赖实测.md P2).
const DeepSeekSearchURL = "https://api.deepseek.com/v1/tools/search"

const maxQueryLen = 128

// DeepSeekSearch is the DeepSeek search client (engine value "deepseek").
type DeepSeekSearch struct {
	Key  config.Secret
	URL  string // overridable for tests; empty = DeepSeekSearchURL
	HTTP *http.Client
}

func (d *DeepSeekSearch) Name() string { return "deepseek" }

type deepseekItem struct {
	Title       string   `json:"title"`
	URL         string   `json:"url"`
	Summary     string   `json:"summary"`
	Date        string   `json:"date"`
	RerankScore *float64 `json:"rerank_score"`
	Authority   *float64 `json:"authority"`
	SiteIcon    string   `json:"site_icon"`
}

// BuildSiteExclusion appends greedy "-site:" suffixes within the 128-char
// budget (§6.1 L2). Port of _build_site_exclusion, including its spacing quirk.
func BuildSiteExclusion(query string, exclude []string) string {
	if len(exclude) == 0 {
		return query
	}
	cats := append([]string(nil), exclude...)
	weight := func(c string) int {
		n := 0
		for _, d := range CategoryDomains[c] {
			n += len([]rune(d)) + len(" -site:")
		}
		return n
	}
	sort.SliceStable(cats, func(i, j int) bool { return weight(cats[i]) < weight(cats[j]) })

	var parts []string
	for _, cat := range cats {
		var cand []string
		for _, d := range CategoryDomains[cat] {
			cand = append(cand, "-site:"+d)
		}
		trial := strings.TrimSpace(query + " " + strings.Join(parts, " ") + " " + strings.Join(cand, " "))
		if len([]rune(trial)) <= maxQueryLen {
			parts = append(parts, cand...)
		}
	}
	if len(parts) > 0 {
		return truncateRunes(query+" "+strings.Join(parts, " "), maxQueryLen)
	}
	return truncateRunes(query, maxQueryLen)
}

func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// Search mirrors deepseek_search.py. rerank_score already blends authority and
// freshness, so the ranker treats it separately (§5.3).
func (d *DeepSeekSearch) Search(ctx context.Context, query string, count int, exclude []string) ([]Source, error) {
	payload := map[string]any{
		"query":        BuildSiteExclusion(query, exclude),
		"count":        min(count, 50),
		"need_content": false, // summary is enough; content is ~15k and expensive
	}
	endpoint := d.URL
	if endpoint == "" {
		endpoint = DeepSeekSearchURL
	}
	var data struct {
		Results []deepseekItem `json:"results"`
	}
	if err := postJSON(ctx, d.HTTP, endpoint, d.Key, "deepseek_search", payload, &data); err != nil {
		return nil, err
	}

	out := make([]Source, 0, len(data.Results))
	for _, it := range data.Results {
		s := newSource(it.URL, it.Title, "deepseek")
		s.FaviconURL = strPtr(it.SiteIcon)
		s.PublishedAt = parseISODate(it.Date)
		s.RerankScore = it.RerankScore
		if it.Authority != nil && *it.Authority != -1 {
			s.AuthoritySignal = it.Authority
		}
		s.Summary = it.Summary
		out = append(out, s)
	}
	return out, nil
}
