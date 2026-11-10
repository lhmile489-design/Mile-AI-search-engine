package provider

import "strings"

// Local domain rules, docs/接口设计.md §4.5 (the classifier service is not wired).
// Copied from backend/app/pipeline/classifier.py; order matters (first match wins).
type domainRule struct {
	domain    string
	category  string
	authority float64
}

var domainRules = []domainRule{
	{"arxiv.org", "preprint", 0.8}, {"alphaxiv.org", "preprint", 0.8},
	{"ar5iv.labs.arxiv.org", "preprint", 0.8}, {"openreview.net", "preprint", 0.8},
	{"neurips.cc", "preprint", 0.8}, {"proceedings.neurips.cc", "preprint", 0.8},
	{"aclanthology.org", "preprint", 0.8}, {"proceedings.mlr.press", "preprint", 0.8},

	{"github.com", "code", 0.7}, {"githubusercontent.com", "code", 0.7},
	{"gitlab.com", "code", 0.7}, {"gitee.com", "code", 0.7},
	{"gitcode.com", "code", 0.7}, {"bitbucket.org", "code", 0.7},
	{"pypi.org", "code", 0.7}, {"npmjs.com", "code", 0.7},

	{"rfc-editor.org", "spec", 0.9}, {"datatracker.ietf.org", "spec", 0.9},
	{"w3.org", "spec", 0.9}, {"whatwg.org", "spec", 0.9},
	{"ecma-international.org", "spec", 0.9}, {"khronos.org", "spec", 0.9},

	{"readthedocs.io", "docs", 0.85}, {"developer.mozilla.org", "docs", 0.85},
	{"learn.microsoft.com", "docs", 0.85}, {"docs.python.org", "docs", 0.85},
}

const (
	docsPrefix    = "docs."
	docsAuthority = 0.85
	blogAuthority = 0.5
)

func (r domainRule) matches(domain string) bool {
	return domain == r.domain || strings.HasSuffix(domain, "."+r.domain)
}

// Classify returns (category, categoryRule) for a normalized domain.
func Classify(domain string) (string, string) {
	for _, r := range domainRules {
		if r.matches(domain) {
			return r.category, "domain:" + r.domain
		}
	}
	if strings.HasPrefix(domain, docsPrefix) {
		return "docs", "host-prefix:docs."
	}
	return "blog", "default"
}

// Authority is the static authority score of a domain (§4.5, §5.1).
func Authority(domain string) float64 {
	for _, r := range domainRules {
		if r.matches(domain) {
			return r.authority
		}
	}
	if strings.HasPrefix(domain, docsPrefix) {
		return docsAuthority
	}
	return blogAuthority
}

// Categories is the fixed category set (§4.5).
var Categories = []string{"preprint", "code", "spec", "docs", "blog"}

// CategoryDomains lists the domains per category for engine-side exclusion.
// "blog" has no list: it is the fallback class.
var CategoryDomains = map[string][]string{
	"preprint": {
		"arxiv.org", "alphaxiv.org", "ar5iv.labs.arxiv.org",
		"openreview.net", "neurips.cc", "proceedings.neurips.cc",
		"aclanthology.org", "proceedings.mlr.press",
	},
	"code": {
		"github.com", "githubusercontent.com", "gitlab.com",
		"gitee.com", "gitcode.com", "bitbucket.org", "pypi.org", "npmjs.com",
	},
	"spec": {
		"rfc-editor.org", "datatracker.ietf.org", "w3.org",
		"whatwg.org", "ecma-international.org", "khronos.org",
	},
	"docs": {
		"readthedocs.io", "developer.mozilla.org",
		"learn.microsoft.com", "docs.python.org",
	},
}

// ExcludeCategories returns the categories NOT in scopeFilters, or nil when the
// filter is empty (no limit). Same rule the Python pipeline applies per query.
func ExcludeCategories(scopeFilters []string) []string {
	if len(scopeFilters) == 0 {
		return nil
	}
	allowed := map[string]bool{}
	for _, s := range scopeFilters {
		allowed[s] = true
	}
	var out []string
	for _, c := range Categories {
		if !allowed[c] {
			out = append(out, c)
		}
	}
	return out
}
