package pipeline

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/lhmile489-design/mile-ai-search/internal/provider"
)

type classifyCase struct {
	Domain    string  `json:"domain"`
	Category  string  `json:"category"`
	Rule      string  `json:"rule"`
	Authority float64 `json:"authority"`
}

// Expected values come from running the Python classifier
// (testdata/gen_classify.py), not from hand calculation.
func TestClassifyParityWithPython(t *testing.T) {
	b, err := os.ReadFile("testdata/python_classify.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []classifyCase
	if err := json.Unmarshal(b, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) < 50 {
		t.Fatalf("too few cases: %d", len(cases))
	}
	var c Classifier = LocalRuleClassifier{}
	for _, tc := range cases {
		got := c.Classify(tc.Domain)
		if got.Category != tc.Category || got.CategoryRule != tc.Rule {
			t.Errorf("%q: got (%s, %s), python (%s, %s)", tc.Domain, got.Category, got.CategoryRule, tc.Category, tc.Rule)
		}
		if a := provider.Authority(tc.Domain); a != tc.Authority {
			t.Errorf("%q: authority %v, python %v", tc.Domain, a, tc.Authority)
		}
	}
}

func TestClassifyContractFields(t *testing.T) {
	got := LocalRuleClassifier{}.Classify("arxiv.org")
	if got.CategorySource != "rule" {
		t.Errorf("categorySource = %q, want rule", got.CategorySource)
	}
	if got.Confidence != nil {
		t.Errorf("confidence must be nil for rule classification, got %v", *got.Confidence)
	}
	valid := map[string]bool{"preprint": true, "code": true, "spec": true, "docs": true, "blog": true}
	for _, d := range []string{"arxiv.org", "github.com", "w3.org", "docs.rs", "medium.com", ""} {
		if cat := (LocalRuleClassifier{}).Classify(d).Category; !valid[cat] {
			t.Errorf("%q: category %q outside the five classes", d, cat)
		}
	}
}
