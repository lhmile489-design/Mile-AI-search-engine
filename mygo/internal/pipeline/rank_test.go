package pipeline

import (
	"math"
	"testing"
)

func f(v float64) *float64 { return &v }

func near(a, b float64) bool { return math.Abs(a-b) < 1e-6 }

// Expected values come from backend/app/pipeline/ranker.compute_score.
func TestComputeScoreParityWithPython(t *testing.T) {
	cases := []struct {
		name         string
		engine       string
		raw, rerank  *float64
		authority    float64
		fresh        *float64
		focus        string
		final        float64
		wRel, wAuth  float64
		wFresh       float64
		wantRelevant *float64
	}{
		{"tavily web", "tavily", f(0.8), nil, 0.7, f(0.5), "web", 0.72, 0.5, 0.35, 0.15, f(0.8)},
		{"tavily academic no freshness", "tavily", f(0.8), nil, 0.7, nil, "academic", 0.7375, 0.375, 0.625, 0, f(0.8)},
		{"tavily code", "tavily", f(0.6), nil, 0.9, f(0.25), "code", 0.65, 0.4, 0.4, 0.2, f(0.6)},
		{"deepseek normal", "deepseek", nil, f(2.1), 0.8, f(0.6), "web", 0.7, 1, 0, 0, f(0.7)},
		{"deepseek missing score", "deepseek", nil, nil, 0.8, f(0.6), "web", 0, 1, 0, 0, nil},
		{"deepseek clamped", "deepseek", nil, f(4.5), 0.5, nil, "code", 1, 1, 0, 0, f(1)},
	}
	for _, c := range cases {
		final, sc := ComputeScore(c.engine, c.raw, c.rerank, c.authority, c.fresh, c.focus)
		if !near(final, c.final) {
			t.Errorf("%s: final = %v, want %v", c.name, final, c.final)
		}
		w := sc.Weights
		if !near(w["relevance"], c.wRel) || !near(w["authority"], c.wAuth) || !near(w["freshness"], c.wFresh) {
			t.Errorf("%s: weights = %v, want %v/%v/%v", c.name, w, c.wRel, c.wAuth, c.wFresh)
		}
		switch {
		case c.wantRelevant == nil && sc.Relevance != nil:
			t.Errorf("%s: relevance should be nil, got %v", c.name, *sc.Relevance)
		case c.wantRelevant != nil && (sc.Relevance == nil || !near(*sc.Relevance, *c.wantRelevant)):
			t.Errorf("%s: relevance mismatch", c.name)
		}
	}
}
