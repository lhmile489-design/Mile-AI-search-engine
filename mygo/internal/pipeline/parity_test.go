package pipeline

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/lhmile489-design/mile-ai-search/internal/contract"
	"github.com/lhmile489-design/mile-ai-search/internal/textutil"
)

// Expected values come from running the Python reference (testdata/gen_parity.py),
// never from hand calculation.
type parityFile struct {
	Citations []struct {
		Name    string `json:"name"`
		Report  string `json:"report"`
		Sources []struct {
			Index   int     `json:"index"`
			Domain  string  `json:"domain"`
			Passage *string `json:"passage"`
		} `json:"sources"`
		Citations    []contract.Citation `json:"citations"`
		Hallucinated []int               `json:"hallucinated"`
		Consensus    *contract.Consensus `json:"consensus"`
	} `json:"citations"`
	Bibtex []struct {
		Category    string  `json:"category"`
		Title       string  `json:"title"`
		URL         string  `json:"url"`
		PublishedAt string  `json:"publishedAt"`
		Expected    *string `json:"expected"`
	} `json:"bibtex"`
	Fences []struct {
		In  string `json:"in"`
		Out string `json:"out"`
	} `json:"fences"`
	FinalizeJSON []struct {
		In  string         `json:"in"`
		Out map[string]any `json:"out"`
	} `json:"finalizeJSON"`
	Sentences []struct {
		In    string   `json:"in"`
		Spans [][2]int `json:"spans"`
	} `json:"sentences"`
}

func loadParity(t *testing.T) parityFile {
	t.Helper()
	b, err := os.ReadFile("testdata/python_parity.json")
	if err != nil {
		t.Fatal(err)
	}
	var p parityFile
	if err := json.Unmarshal(b, &p); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestParseCitationsParity(t *testing.T) {
	for _, c := range loadParity(t).Citations {
		t.Run(c.Name, func(t *testing.T) {
			var srcs []contract.SourceCard
			for _, s := range c.Sources {
				idx := s.Index
				srcs = append(srcs, contract.SourceCard{
					RawSource: contract.RawSource{Domain: s.Domain},
					Index:     &idx,
					Passage:   s.Passage,
				})
			}
			cits, hall := ParseCitations(c.Report, srcs)
			if len(cits) != len(c.Citations) {
				t.Fatalf("citations len %d want %d: %+v", len(cits), len(c.Citations), cits)
			}
			for i := range cits {
				if !reflect.DeepEqual(cits[i], c.Citations[i]) {
					t.Errorf("cit[%d] got %+v hl=%+v want %+v hl=%+v", i, cits[i], cits[i].Highlight, c.Citations[i], c.Citations[i].Highlight)
				}
			}
			if len(hall) != len(c.Hallucinated) {
				t.Errorf("hallucinated %v want %v", hall, c.Hallucinated)
			}
			cons := ComputeConsensus(c.Report, cits, srcs)
			if !reflect.DeepEqual(cons, c.Consensus) {
				t.Errorf("consensus got %+v want %+v", cons, c.Consensus)
			}
		})
	}
}

func TestBibtexParity(t *testing.T) {
	for _, c := range loadParity(t).Bibtex {
		got := GenerateBibtex(c.Category, c.Title, c.URL, c.PublishedAt)
		want := ""
		if c.Expected != nil {
			want = *c.Expected
		}
		if got != want {
			t.Errorf("%q: got %q want %q", c.Title, got, want)
		}
	}
}

func TestBalanceFencesParity(t *testing.T) {
	for _, c := range loadParity(t).Fences {
		got, _ := BalanceFences(c.In)
		if got != c.Out {
			t.Errorf("%q: got %q want %q", c.In, got, c.Out)
		}
	}
}

func TestParseFinalizeJSONParity(t *testing.T) {
	for _, c := range loadParity(t).FinalizeJSON {
		got := ParseFinalizeJSON(c.In)
		if c.Out == nil {
			if got != nil {
				t.Errorf("%q: want nil got %v", c.In, got)
			}
			continue
		}
		if got == nil {
			t.Errorf("%q: want %v got nil", c.In, c.Out)
			continue
		}
		for k := range c.Out {
			if _, ok := got[k]; !ok {
				t.Errorf("%q: missing key %s", c.In, k)
			}
		}
	}
}

func TestSplitSentencesParity(t *testing.T) {
	for _, c := range loadParity(t).Sentences {
		got := textutil.SplitSentences(c.In)
		if len(got) != len(c.Spans) {
			t.Errorf("%q: %v want %v", c.In, got, c.Spans)
			continue
		}
		for i, g := range got {
			if g.Start != c.Spans[i][0] || g.End != c.Spans[i][1] {
				t.Errorf("%q span %d: %v want %v", c.In, i, g, c.Spans[i])
			}
		}
	}
}
