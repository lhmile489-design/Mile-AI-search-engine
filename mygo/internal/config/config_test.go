package config

import (
	"fmt"
	"testing"
	"time"
)

func TestSecretNeverPrints(t *testing.T) {
	s := Secret("sk-very-secret")
	c := Config{LLMAPIKey: s, TavilyAPIKey: s}
	for _, out := range []string{
		fmt.Sprintf("%v", s), fmt.Sprintf("%+v", c), fmt.Sprintf("%#v", c), fmt.Sprintf("%s", s),
	} {
		if containsSecret(out) {
			t.Fatalf("secret leaked: %s", out)
		}
	}
	if s.Reveal() != "sk-very-secret" {
		t.Fatal("Reveal must return raw key")
	}
}

func containsSecret(s string) bool {
	for i := 0; i+14 <= len(s); i++ {
		if s[i:i+14] == "sk-very-secret" {
			return true
		}
	}
	return false
}

func TestEmptyValuesFallBackToDefaults(t *testing.T) {
	env := ParseEnv(utf8BOM + "LLM_BASE_URL=\nLLM_MODEL=\n# comment\nLLM_API_KEY=\"abc\"\nTAVILY_API_KEY=\nREWRITE_TIMEOUT_S=7.5\n")
	c := FromLookup(func(k string) string { return env[k] })
	if c.LLMBaseURL != DefaultLLMBaseURL || c.LLMModel != DefaultLLMModel {
		t.Fatalf("defaults not applied: %q %q", c.LLMBaseURL, c.LLMModel)
	}
	if c.LLMAPIKey.Reveal() != "abc" || c.TavilyAPIKey.Set() {
		t.Fatal("key parsing wrong")
	}
	if c.Timeouts.Rewrite != 7500*time.Millisecond || c.Timeouts.Search != 10*time.Second {
		t.Fatalf("timeouts wrong: %+v", c.Timeouts)
	}
	if !c.EngineAvailable("deepseek") || c.EngineAvailable("tavily") || c.EngineAvailable("x") {
		t.Fatal("engine availability wrong")
	}
}
