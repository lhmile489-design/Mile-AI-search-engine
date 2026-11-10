// Package config loads runtime settings from the process environment and the
// per-user %APPDATA%\MileAISearch\.env file. Field names match
// backend/.env.example. Empty values count as unset (the Python
// env_ignore_empty semantics), so `LLM_MODEL=` falls back to the default.
package config

import (
	"bufio"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Secret holds an API key. Every formatting verb prints a mask, so a stray
// log line or %+v cannot leak it. Use Reveal at the single point of use.
type Secret string

const mask = "***"

// utf8BOM is the three UTF-8 bytes of U+FEFF, spelled as hex byte escapes so
// the source file stays plain ASCII and carries no literal BOM.
const utf8BOM = "\xef\xbb\xbf"

func (Secret) String() string   { return mask }
func (Secret) GoString() string { return mask }

// MarshalText keeps the key out of JSON / text encoders as well.
func (Secret) MarshalText() ([]byte, error) { return []byte(mask), nil }

// Reveal returns the raw key for building an Authorization header.
func (s Secret) Reveal() string { return string(s) }

// Set reports whether a key is configured.
func (s Secret) Set() bool { return s != "" }

// Timeouts is the pipeline timeout table, copied from backend/app/config.py.
type Timeouts struct {
	Rewrite         time.Duration
	Search          time.Duration
	Classifier      time.Duration // reserved: the classifier service is not wired
	GenerateFirstTk time.Duration
	Finalize        time.Duration
}

// Config is the resolved runtime configuration.
type Config struct {
	LLMAPIKey    Secret
	LLMBaseURL   string
	LLMModel     string
	TavilyAPIKey Secret
	Timeouts     Timeouts
	RankingTopK  int
}

const (
	DefaultLLMBaseURL = "https://api.deepseek.com"
	DefaultLLMModel   = "deepseek-flash"
)

// Defaults returns the built-in values (python config.py).
func Defaults() Config {
	return Config{
		LLMBaseURL: DefaultLLMBaseURL,
		LLMModel:   DefaultLLMModel,
		Timeouts: Timeouts{
			Rewrite:         15 * time.Second,
			Search:          10 * time.Second,
			Classifier:      2500 * time.Millisecond,
			GenerateFirstTk: 30 * time.Second,
			Finalize:        10 * time.Second,
		},
		RankingTopK: 10,
	}
}

// EnvFilePath is %APPDATA%\MileAISearch\.env ("" when APPDATA is unset).
func EnvFilePath() string {
	dir := os.Getenv("APPDATA")
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, "MileAISearch", ".env")
}

// ParseEnv parses KEY=VALUE lines. Comments (#), blanks and malformed lines
// are skipped; surrounding quotes are stripped; a UTF-8 BOM is tolerated.
func ParseEnv(content string) map[string]string {
	out := map[string]string{}
	sc := bufio.NewScanner(strings.NewReader(strings.TrimPrefix(content, utf8BOM)))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		if len(v) >= 2 && (v[0] == '"' || v[0] == '\'') && v[len(v)-1] == v[0] {
			v = v[1 : len(v)-1]
		}
		if k != "" {
			out[k] = v
		}
	}
	return out
}

// Load resolves config from the env file then the process environment (the
// environment wins, as with pydantic-settings). A missing file is not an error.
func Load() Config {
	var file map[string]string
	if p := EnvFilePath(); p != "" {
		if b, err := os.ReadFile(p); err == nil {
			file = ParseEnv(string(b))
		}
	}
	return FromLookup(func(key string) string {
		if v := os.Getenv(key); v != "" {
			return v
		}
		return file[key]
	})
}

// FromLookup builds a Config from any key lookup; empty strings mean unset.
func FromLookup(get func(string) string) Config {
	c := Defaults()
	c.LLMAPIKey = Secret(get("LLM_API_KEY"))
	c.TavilyAPIKey = Secret(get("TAVILY_API_KEY"))
	if v := get("LLM_BASE_URL"); v != "" {
		c.LLMBaseURL = v
	}
	if v := get("LLM_MODEL"); v != "" {
		c.LLMModel = v
	}
	setSeconds(get, "REWRITE_TIMEOUT_S", &c.Timeouts.Rewrite)
	setSeconds(get, "SEARCH_TIMEOUT_S", &c.Timeouts.Search)
	setSeconds(get, "CLASSIFIER_TIMEOUT_S", &c.Timeouts.Classifier)
	setSeconds(get, "GENERATE_FIRST_TOKEN_TIMEOUT_S", &c.Timeouts.GenerateFirstTk)
	setSeconds(get, "FINALIZE_TIMEOUT_S", &c.Timeouts.Finalize)
	if v := get("RANKING_TOP_K"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			c.RankingTopK = n
		}
	}
	return c
}

func setSeconds(get func(string) string, key string, dst *time.Duration) {
	v := get(key)
	if v == "" {
		return
	}
	if f, err := strconv.ParseFloat(v, 64); err == nil && f > 0 {
		*dst = time.Duration(f * float64(time.Second))
	}
}

// EngineAvailable reports whether the named engine has a key configured.
func (c Config) EngineAvailable(engine string) bool {
	switch engine {
	case "tavily":
		return c.TavilyAPIKey.Set()
	case "deepseek":
		return c.LLMAPIKey.Set()
	}
	return false
}
