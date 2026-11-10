package provider

import "testing"

// Expected values were produced by running backend/app/pipeline/providers
// (normalize_url, stable_id, extract_domain, display_url) on the same inputs.
func TestURLParityWithPython(t *testing.T) {
	cases := []struct{ in, norm, id, domain, display string }{
		{"https://www.Example.com:443/a/b/?utm_source=x&q=1#frag", "https://example.com/a/b?q=1", "src_2fff419f1f69", "example.com", "https://www.Example.com:443/a/b/?utm_source=x&q=1"},
		{"http://example.com:80", "http://example.com/", "src_2a1b402420ef", "example.com", "http://example.com:80"},
		{"https://github.com/repo#1", "https://github.com/repo", "src_c8a31c098f4f", "github.com", "https://github.com/repo"},
		{"https://arxiv.org/abs/1234?x=a+b&y=%E4%B8%AD", "https://arxiv.org/abs/1234?x=a+b&y=%E4%B8%AD", "src_321f79c4366c", "arxiv.org", "https://arxiv.org/abs/1234?x=a+b&y=%E4%B8%AD"},
		{"HTTPS://Docs.Python.org/3/", "https://docs.python.org/3", "src_b4365d45965b", "docs.python.org", "HTTPS://Docs.Python.org/3/"},
		{"https://a.com:8080/p/", "https://a.com:8080/p", "src_edbc83382efe", "a.com", "https://a.com:8080/p/"},
	}
	for _, c := range cases {
		if got := NormalizeURL(c.in); got != c.norm {
			t.Errorf("NormalizeURL(%q) = %q, want %q", c.in, got, c.norm)
		}
		if got := StableID(c.in); got != c.id {
			t.Errorf("StableID(%q) = %q, want %q", c.in, got, c.id)
		}
		if got := ExtractDomain(c.in); got != c.domain {
			t.Errorf("ExtractDomain(%q) = %q, want %q", c.in, got, c.domain)
		}
		if got := DisplayURL(c.in); got != c.display {
			t.Errorf("DisplayURL(%q) = %q, want %q", c.in, got, c.display)
		}
	}
}
