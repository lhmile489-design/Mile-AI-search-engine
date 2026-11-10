package pipeline

import "github.com/lhmile489-design/mile-ai-search/internal/provider"

// Classification is one source's category. Confidence is nil for the local
// rule classifier: a domain rule has no probability to report.
type Classification struct {
	Category       string
	CategorySource string // "rule" for the local table
	CategoryRule   string // e.g. "domain:arxiv.org", "host-prefix:docs.", "default"
	Confidence     *float64
}

// Classifier assigns a category to a normalized domain (contract §8).
type Classifier interface {
	Classify(domain string) Classification
}

// LocalRuleClassifier applies the domain table from contract §4.5. It makes no
// outbound call, so it never fails and never times out.
type LocalRuleClassifier struct{}

// Classify implements Classifier.
func (LocalRuleClassifier) Classify(domain string) Classification {
	cat, rule := provider.Classify(domain)
	return Classification{Category: cat, CategorySource: "rule", CategoryRule: rule}
}

// JevClassifier is the reserved slot for the remote classifier service. It is
// not implemented: the key is missing and its response shape is unverified, so
// nothing may pretend to call it. Wiring it in means implementing Classify and
// returning CategorySource "model" with a measured Confidence.
type JevClassifier struct{}
