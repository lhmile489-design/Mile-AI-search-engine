package pipeline

import (
	"math"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/lhmile489-design/mile-ai-search/internal/contract"
	"github.com/lhmile489-design/mile-ai-search/internal/provider"
)

type weightSet struct{ Rel, Auth, Fresh float64 }

// weights per focusMode (§5.2, ranker.py _WEIGHTS). Unknown modes use web.
var weights = map[string]weightSet{
	"academic": {0.30, 0.50, 0.20},
	"code":     {0.40, 0.40, 0.20},
	"web":      {0.50, 0.35, 0.15},
}

const freshnessHalfLifeDays = 365.0

// Freshness is 0.5^(ageDays/365); nil when the date is missing or unparsable;
// 1.0 for dates in the future (§5.1).
func Freshness(publishedAt *string, now time.Time) *float64 {
	if publishedAt == nil || *publishedAt == "" {
		return nil
	}
	t, err := time.Parse(time.RFC3339, *publishedAt)
	if err != nil {
		return nil
	}
	age := now.Sub(t).Seconds() / 86400.0
	v := 1.0
	if age > 0 {
		v = math.Pow(0.5, age/freshnessHalfLifeDays)
	}
	return &v
}

func round6(x float64) float64 { return math.Round(x*1e6) / 1e6 }

func fp(v float64) *float64 { return &v }

func derefOr(p *float64, d float64) float64 {
	if p == nil {
		return d
	}
	return *p
}

// ComputeScore returns the unrounded final score used for ordering and the
// scores object sent to the page (§5, ranker.py compute_score).
func ComputeScore(engine string, raw, rerank *float64, authority float64, fresh *float64, focusMode string) (float64, contract.SourceScores) {
	w, ok := weights[focusMode]
	if !ok {
		w = weights["web"]
	}

	if engine == "deepseek" {
		// §5.3: the engine's rerank_score already blends authority + recency.
		var rel *float64
		final := 0.0
		if rerank != nil {
			r := math.Min(math.Max(*rerank/3.0, 0), 1)
			rel = &r
			final = r
		}
		return final, contract.SourceScores{
			Relevance: rel,
			Authority: fp(authority), // display only
			Freshness: fresh,         // display only
			Final:     fp(final),
			Weights:   map[string]float64{"relevance": 1.0, "authority": 0.0, "freshness": 0.0},
		}
	}

	var actual map[string]float64
	var final float64
	if fresh == nil {
		total := w.Rel + w.Auth
		wr, wa := round6(w.Rel/total), round6(w.Auth/total)
		actual = map[string]float64{"relevance": wr, "authority": wa, "freshness": 0.0}
		final = wr*derefOr(raw, 0) + wa*authority
	} else {
		actual = map[string]float64{"relevance": w.Rel, "authority": w.Auth, "freshness": w.Fresh}
		final = w.Rel*derefOr(raw, 0) + w.Auth*authority + w.Fresh*(*fresh)
	}
	return final, contract.SourceScores{
		Relevance: raw,
		Authority: fp(authority),
		Freshness: fresh,
		Final:     fp(round6(final)),
		Weights:   actual,
	}
}

// dedupScore mirrors Python's `raw or rerank or 0.0` (zero counts as unset).
func dedupScore(s *provider.Source) float64 {
	if s.RawScore != nil && *s.RawScore != 0 {
		return *s.RawScore
	}
	if s.RerankScore != nil && *s.RerankScore != 0 {
		return *s.RerankScore
	}
	return 0
}

func mergeInts(a, b []int) []int {
	seen := map[int]bool{}
	var out []int
	for _, v := range append(append([]int{}, a...), b...) {
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	sort.Ints(out)
	return out
}

// RankStats feeds the reasoning-end trace detail (§3.1, ranker.py rank_stats).
type RankStats struct {
	InputCount, DedupedCount, FilteredCount, RankedCount, K int
}

// Stats computes the counts the same way Python does: unique normalized URLs,
// and of those the ones with at least one hit inside the allowed categories.
func Stats(all []provider.Source, scope []string, ranked int) RankStats {
	keys := map[string]bool{}
	inScope := map[string]bool{}
	for _, s := range all {
		k := provider.NormalizeURL(s.URL)
		keys[k] = true
		if len(scope) > 0 && contains(scope, s.Category) {
			inScope[k] = true
		}
	}
	filtered := len(keys)
	if len(scope) > 0 {
		filtered = len(inScope)
	}
	return RankStats{InputCount: len(all), DedupedCount: len(keys), FilteredCount: filtered, RankedCount: ranked, K: ranked}
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// RankSources dedups by normalized URL, filters by the allowed categories,
// scores, sorts descending (stable) and keeps the top K, numbering from 1.
// Not in scope here (G3b): BibTeX.
func RankSources(in []provider.Source, focusMode string, scope []string, topK int, now time.Time) []contract.SourceCard {
	// dedup: first-seen order, the higher-scoring duplicate wins
	index := map[string]int{}
	var order []*provider.Source
	for i := range in {
		s := in[i]
		s.MatchedQueries = append([]int{}, s.MatchedQueries...)
		key := provider.NormalizeURL(s.URL)
		pos, seen := index[key]
		if !seen {
			index[key] = len(order)
			order = append(order, &s)
			continue
		}
		existing := order[pos]
		merged := mergeInts(existing.MatchedQueries, s.MatchedQueries)
		if dedupScore(&s) > dedupScore(existing) {
			s.MatchedQueries = merged
			order[pos] = &s
		} else {
			existing.MatchedQueries = merged
		}
	}

	type scored struct {
		final  float64
		src    *provider.Source
		scores contract.SourceScores
	}
	var list []scored
	for _, s := range order {
		if len(scope) > 0 && !contains(scope, s.Category) {
			continue
		}
		final, sc := ComputeScore(s.Engine, s.RawScore, s.RerankScore, provider.Authority(s.Domain), Freshness(s.PublishedAt, now), focusMode)
		list = append(list, scored{final, s, sc})
	}
	sort.SliceStable(list, func(i, j int) bool { return list[i].final > list[j].final })
	if topK > 0 && len(list) > topK {
		list = list[:topK]
	}

	out := make([]contract.SourceCard, 0, len(list))
	for i, it := range list {
		s := it.src
		cat, rule := provider.Classify(s.Domain)
		passageRaw := s.Summary
		if passageRaw == "" {
			passageRaw = s.Content
		}
		text, truncated := provider.CleanPassage(passageRaw)
		var passage *string
		if text != "" {
			passage = &text
		}
		idx := i + 1
		trunc := truncated
		mq := s.MatchedQueries
		if mq == nil {
			mq = []int{}
		}
		out = append(out, contract.SourceCard{
			RawSource: contract.RawSource{
				ID: s.ID, Title: s.Title, URL: s.URL, Domain: s.Domain,
				FaviconURL: s.FaviconURL, Engine: s.Engine,
				Category: cat, CategorySource: "rule", PublishedAt: s.PublishedAt,
			},
			Index:            &idx,
			CategoryRule:     rule,
			Passage:          passage,
			PassageTruncated: &trunc,
			Scores:           it.scores,
			EngineSignals:    engineSignals(s),
			MatchedQueries:   mq,
			PDFURL:           pdfURL(s.URL),
		})
	}
	return out
}

func engineSignals(s *provider.Source) map[string]float64 {
	sig := map[string]float64{}
	switch s.Engine {
	case "tavily":
		if s.RawScore != nil {
			sig["score"] = *s.RawScore
		}
	case "deepseek":
		if s.RerankScore != nil {
			sig["rerankScore"] = *s.RerankScore
		}
		if s.AuthoritySignal != nil {
			sig["authority"] = *s.AuthoritySignal
		}
	}
	return sig
}

func pdfURL(raw string) *string {
	u, err := url.Parse(raw)
	if err != nil || !strings.HasSuffix(strings.ToLower(u.Path), ".pdf") {
		return nil
	}
	return &raw
}
