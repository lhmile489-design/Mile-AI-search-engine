package pipeline

import (
	"encoding/json"
	"math"
	"os"
	"reflect"
	"sort"
	"testing"
	"time"

	"github.com/lhmile489-design/mile-ai-search/internal/provider"
)

// Function-level rerank parity: the same captured raw input goes through the
// Python rank_sources (testdata/gen_rank.py) and RankSources. Expected values
// come from running Python, never from hand calculation.

type pyRankCase struct {
	FocusMode string   `json:"focusMode"`
	Scope     []string `json:"scope"`
	Now       string   `json:"now"`
	Ranked    []struct {
		Index          int      `json:"index"`
		URL            string   `json:"url"`
		Category       string   `json:"category"`
		Relevance      float64  `json:"relevance"`
		Authority      float64  `json:"authority"`
		Freshness      *float64 `json:"freshness"`
		Final          float64  `json:"final"`
		MatchedQueries []int    `json:"matchedQueries"`
	} `json:"ranked"`
}

func TestRankSourcesParityWithPython(t *testing.T) {
	var in []provider.Source
	rb, err := os.ReadFile("testdata/rank_input.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(rb, &in); err != nil {
		t.Fatal(err)
	}
	var cases []pyRankCase
	pb, err := os.ReadFile("testdata/python_rank.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(pb, &cases); err != nil {
		t.Fatal(err)
	}
	if len(in) == 0 || len(cases) == 0 {
		t.Fatal("empty fixtures")
	}
	const tol = 1e-6
	for _, c := range cases {
		now, err := time.Parse(time.RFC3339, c.Now)
		if err != nil {
			t.Fatal(err)
		}
		cp := make([]provider.Source, len(in))
		copy(cp, in)
		got := RankSources(cp, c.FocusMode, c.Scope, 30, now)
		if len(got) != len(c.Ranked) {
			t.Fatalf("%s %v: got %d ranked, python %d", c.FocusMode, c.Scope, len(got), len(c.Ranked))
		}
		for i, want := range c.Ranked {
			g := got[i]
			if g.URL != want.URL {
				t.Errorf("%s %v #%d url: got %s want %s", c.FocusMode, c.Scope, i+1, g.URL, want.URL)
				continue
			}
			if g.Category != want.Category {
				t.Errorf("#%d %s category: got %s want %s", i+1, g.URL, g.Category, want.Category)
			}
			chk := func(name string, got *float64, want float64) {
				if got == nil || math.Abs(*got-want) > tol {
					t.Errorf("#%d %s %s: got %v want %v", i+1, g.URL, name, got, want)
				}
			}
			chk("relevance", g.Scores.Relevance, want.Relevance)
			chk("authority", g.Scores.Authority, want.Authority)
			chk("final", g.Scores.Final, want.Final)
			if (g.Scores.Freshness == nil) != (want.Freshness == nil) {
				t.Errorf("#%d %s freshness nil mismatch: got %v want %v", i+1, g.URL, g.Scores.Freshness, want.Freshness)
			} else if want.Freshness != nil {
				chk("freshness", g.Scores.Freshness, *want.Freshness)
			}
			mq := append([]int{}, g.MatchedQueries...)
			sort.Ints(mq)
			wq := append([]int{}, want.MatchedQueries...)
			if !reflect.DeepEqual(mq, wq) {
				t.Errorf("#%d %s matchedQueries: got %v want %v", i+1, g.URL, mq, wq)
			}
		}
	}
}
