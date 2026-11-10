package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lhmile489-design/mile-ai-search/internal/config"
	"github.com/lhmile489-design/mile-ai-search/internal/contract"
)

const (
	testLLMKey = "sk-test-llm-0123456789"
	testTavKey = "tvly-test-9876543210"
)

// isolate points %APPDATA% at a temp dir and clears the key env vars so Load
// reads only the file under test.
func isolate(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("APPDATA", dir)
	t.Setenv("LLM_API_KEY", "")
	t.Setenv("TAVILY_API_KEY", "")
	return filepath.Join(dir, "MileAISearch", ".env")
}

func engineValues(cfg contract.AppConfig) []string {
	var out []string
	for _, e := range cfg.Engines {
		out = append(out, e.Value)
	}
	return out
}

func TestSaveSettingsMakesEnginesAvailableWithoutRestart(t *testing.T) {
	isolate(t)
	svc := SearchService{}
	if got := engineValues(BuildConfig(config.Load())); len(got) != 0 {
		t.Fatalf("engines before save: %v", got)
	}
	if err := svc.SaveSettings(contract.Settings{TavilyAPIKey: testTavKey}); err != nil {
		t.Fatal(err)
	}
	if got := engineValues(BuildConfig(config.Load())); len(got) != 1 || got[0] != "tavily" {
		t.Fatalf("engines after tavily: %v", got)
	}
	if err := svc.SaveSettings(contract.Settings{LLMAPIKey: testLLMKey}); err != nil {
		t.Fatal(err)
	}
	if got := engineValues(BuildConfig(config.Load())); len(got) != 2 {
		t.Fatalf("engines after both: %v", got)
	}
}

func TestSaveSettingsEmptyValueKeepsOldKeyAndOtherLines(t *testing.T) {
	path := isolate(t)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	seed := "# my comment\nLLM_MODEL=custom-model\nTAVILY_API_KEY=" + testTavKey + "\n"
	if err := os.WriteFile(path, []byte(seed), 0o600); err != nil {
		t.Fatal(err)
	}
	svc := SearchService{}
	if err := svc.SaveSettings(contract.Settings{LLMAPIKey: testLLMKey, TavilyAPIKey: ""}); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	got := string(b)
	for _, want := range []string{"# my comment", "LLM_MODEL=custom-model", "TAVILY_API_KEY=" + testTavKey, "LLM_API_KEY=" + testLLMKey} {
		if !strings.Contains(got, want) {
			t.Errorf("env file lost %q:\n%s", want, got)
		}
	}
	if strings.HasPrefix(got, "\xef\xbb\xbf") {
		t.Errorf("env file has a BOM")
	}
	if cfg := config.Load(); string(cfg.TavilyAPIKey.Reveal()) != testTavKey {
		t.Errorf("empty value overwrote the Tavily key")
	}
}

func TestSaveSettingsNeverEchoesKeys(t *testing.T) {
	isolate(t)
	var logBuf bytes.Buffer
	log.SetOutput(&logBuf)
	defer log.SetOutput(os.Stderr)

	svc := SearchService{}
	err := svc.SaveSettings(contract.Settings{LLMAPIKey: testLLMKey, TavilyAPIKey: testTavKey})
	if err != nil {
		t.Fatal(err)
	}
	// A rejected value must not echo the key either.
	bad := svc.SaveSettings(contract.Settings{LLMAPIKey: testLLMKey + "\nINJECT=1"})
	if bad == nil {
		t.Fatal("a value with a newline must be rejected")
	}

	cfgJSON, _ := json.Marshal(BuildConfig(config.Load()))
	surfaces := map[string]string{
		"log":        logBuf.String(),
		"error":      fmt.Sprint(bad),
		"config":     string(cfgJSON),
		"config %+v": fmt.Sprintf("%+v", config.Load()),
	}
	for name, s := range surfaces {
		for _, k := range []string{testLLMKey, testTavKey} {
			if strings.Contains(s, k) {
				t.Errorf("%s leaks a key", name)
			}
		}
	}
}
