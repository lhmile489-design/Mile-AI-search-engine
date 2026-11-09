// Package contract defines the Go/TypeScript boundary types for the search
// pipeline, mirroring docs/接口设计.md §3 (SSE payloads → StreamFrame), §4
// (SourceCard / RawSource), §7 (citations), and §13 (config / history /
// suggestions). mygo generate turns these into src/mygo.ts types.
//
// Conventions carried over from the contract doc:
//   - All citation offsets are UTF-16 code units (JS String.slice).
//   - Times that cross the wire are ISO 8601 UTC strings; durations are int ms.
//   - "null means uncomputable" — nullable fields are pointers or use
//     omitempty only where the field may be absent entirely.
//   - Error codes follow §12 (40001, 40002, 40401, 50001, 5020x).
package contract

// ---- Request (§2.1) ----

// SearchRequest is the body of a search call.
type SearchRequest struct {
	Query        string   `json:"query"`        // trimmed, 1–500 runes
	FocusMode    string   `json:"focusMode"`    // academic | code | web
	Engine       string   `json:"engine"`       // tavily | deepseek
	ScopeFilters []string `json:"scopeFilters"` // allowed categories; empty = all
}

// ---- StreamFrame: the union carried on mygo.Channel (G1 writing A) ----
// One struct, Type tag + every payload optional. The page narrows on .type.
// Type values: trace | sources | token | related | done | error.

type StreamFrame struct {
	Type    string          `json:"type"`
	Trace   *TracePayload   `json:"trace,omitempty"`
	Sources *SourcesPayload `json:"sources,omitempty"`
	Token   *TokenPayload   `json:"token,omitempty"`
	Related *RelatedPayload `json:"related,omitempty"`
	Done    *DonePayload    `json:"done,omitempty"`
	Error   *ErrorPayload   `json:"error,omitempty"`
}

// TracePayload is §3.1 `trace` — stage progress.
type TracePayload struct {
	Step      string                 `json:"step"`      // rewriting|searching|reasoning|generating
	Status    string                 `json:"status"`    // start|end|degraded
	AtMs      int64                  `json:"atMs"`      // ms since request received
	ElapsedMs *int64                 `json:"elapsedMs"` // stage duration; only set on status=end
	Message   string                 `json:"message"`   // human-readable line
	Detail    map[string]interface{} `json:"detail"`    // shape varies with step+status
	CacheHit  bool                   `json:"cacheHit"`  // true when replaying cache
}

// SourcesPayload is §3.2 `sources` — raw batches and the ranked list.
// Phase picks which item type `items` holds; we keep two typed slices instead
// of one untyped array so the generated TS is precise.
type SourcesPayload struct {
	Phase      string        `json:"phase"`      // raw | ranked
	Engine     string        `json:"engine"`     // engine for this batch / ranked
	QueryIndex *int          `json:"queryIndex"` // sub-query index for raw; null for ranked
	Raw        []RawSource   `json:"raw"`        // phase=raw
	Ranked     []SourceCard  `json:"ranked"`     // phase=ranked
}

// TokenPayload is §3.3 `token` — a report delta, passed through verbatim.
type TokenPayload struct {
	Delta string `json:"delta"`
}

// RelatedPayload is §3.4 `related` — follow-up questions (3–5).
type RelatedPayload struct {
	Items []string `json:"items"`
}

// DonePayload is §3.5 `done` — the terminal result.
type DonePayload struct {
	HistoryID    *string       `json:"historyId"`
	LatencyMs    int64         `json:"latencyMs"`
	StageTimings StageTimings  `json:"stageTimings"`
	FirstTokenMs *int64        `json:"firstTokenMs"`
	TokenStats   *TokenStats   `json:"tokenStats"`
	Citations    []Citation    `json:"citations"`
	Takeaways    []Takeaway    `json:"takeaways"`
	Consensus    *Consensus    `json:"consensus"`
	Engine       string        `json:"engine"`
	EnginesUsed  []string      `json:"enginesUsed"`
	Degraded     bool          `json:"degraded"`
	SourceCount  int           `json:"sourceCount"`
	CharCount    int           `json:"charCount"`
	CacheHit     bool          `json:"cacheHit"`
}

// ErrorPayload is §3.6 `error` — a terminal failure (no done follows).
type ErrorPayload struct {
	Code      int     `json:"code"`      // §12 error code
	Message   string  `json:"message"`   // user-facing reason, no secrets
	Step      *string `json:"step"`      // failing stage; "finalizing" | null
	Retryable bool    `json:"retryable"` // show retry
	Upstream  *string `json:"upstream"`  // llm|tavily|deepseek_search|classifier|null
}

// ---- Supporting value types ----

type StageTimings struct {
	RewritingMs  int64 `json:"rewritingMs"`
	SearchingMs  int64 `json:"searchingMs"`
	ReasoningMs  int64 `json:"reasoningMs"`
	GeneratingMs int64 `json:"generatingMs"`
	FinalizingMs int64 `json:"finalizingMs"`
}

type TokenStats struct {
	PromptTokens     int `json:"promptTokens"`
	CompletionTokens int `json:"completionTokens"`
	TotalTokens      int `json:"totalTokens"`
	CachedTokens     int `json:"cachedTokens"`
	Calls            int `json:"calls"`
}

type HighlightRange struct {
	Start int     `json:"start"` // UTF-16 offset inside the cited source passage
	End   int     `json:"end"`
	Score float64 `json:"score"`
}

// Citation is §7.2 — one [n] marker resolved against the report text.
type Citation struct {
	Index         int             `json:"index"`         // source index (1..K)
	MarkerStart   int             `json:"markerStart"`   // UTF-16 offset of "[n]" in report
	MarkerEnd     int             `json:"markerEnd"`
	SentenceStart int             `json:"sentenceStart"` // UTF-16 offset of enclosing sentence
	SentenceEnd   int             `json:"sentenceEnd"`
	Highlight     *HighlightRange `json:"highlight"`     // located sentence in the source passage
}

type Takeaway struct {
	Text      string `json:"text"`
	Citations []int  `json:"citations"`
}

type Consensus struct {
	Score              *float64 `json:"score"`
	SupportedSentences int      `json:"supportedSentences"`
	CitedSentences     int      `json:"citedSentences"`
}

// ---- SourceCard / RawSource (§4.1) ----

// SourceScores is §5: relevance/authority/freshness/final + applied weights.
type SourceScores struct {
	Relevance *float64            `json:"relevance"`
	Authority *float64            `json:"authority"`
	Freshness *float64            `json:"freshness"`
	Final     *float64            `json:"final"`
	Weights   map[string]float64  `json:"weights"`
}

// RawSource is the phase=raw trimmed card (the "raw 含" subset).
type RawSource struct {
	ID             string   `json:"id"`
	Title          string   `json:"title"`
	URL            string   `json:"url"`
	Domain         string   `json:"domain"`
	FaviconURL     *string  `json:"faviconUrl"`
	Engine         string   `json:"engine"`
	Category       string   `json:"category"`       // preprint|code|spec|docs|blog
	CategorySource string   `json:"categorySource"` // rule|model
	Confidence     *float64 `json:"confidence"`
	PublishedAt    *string  `json:"publishedAt"` // ISO 8601 UTC
}

// SourceCard is the phase=ranked full card / history snapshot element.
type SourceCard struct {
	RawSource
	Index           *int               `json:"index"`    // 1..K citation number
	CategoryRule    string             `json:"categoryRule"`
	Passage         *string            `json:"passage"`
	PassageTruncated *bool             `json:"passageTruncated"`
	Scores          SourceScores       `json:"scores"`
	EngineSignals   map[string]float64 `json:"engineSignals"`
	MatchedQueries  []int              `json:"matchedQueries"`
	BibTeX          *string            `json:"bibtex"`
	PDFURL          *string            `json:"pdfUrl"`
}

// ---- Config / suggestions / history (§13) ----

// ConfigOption is a {value,label,description} list entry.
type ConfigOption struct {
	Value       string `json:"value"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
}

// EngineOption adds availability (only configured engines are listed).
type EngineOption struct {
	Value     string `json:"value"`
	Label     string `json:"label"`
	Available bool   `json:"available"`
}

// AppConfig is GET /api/config (§13.5).
type AppConfig struct {
	FocusModes []ConfigOption `json:"focusModes"`
	Engines    []EngineOption `json:"engines"`
	Scopes     []ConfigOption `json:"scopes"`
	Version    string         `json:"version"`
}

// SuggestionsData is GET /api/suggestions (§13.6).
type SuggestionsData struct {
	Items []string `json:"items"`
}

// HistoryCard is one row of GET /api/history (§13.2, no report body).
type HistoryCard struct {
	ID          string `json:"id"`
	Query       string `json:"query"`
	FocusMode   string `json:"focusMode"`
	Engine      string `json:"engine"`
	CreatedAt   string `json:"createdAt"`
	SourceCount int    `json:"sourceCount"`
	CharCount   int    `json:"charCount"`
	LatencyMs   int64  `json:"latencyMs"`
	CacheHit    bool   `json:"cacheHit"`
}

// HistoryList is GET /api/history's data.
type HistoryList struct {
	Total   int           `json:"total"`
	Records []HistoryCard `json:"records"`
}

// HistoryDetail is GET /api/history/{id} (§13.3, the full snapshot).
type HistoryDetail struct {
	ID               string          `json:"id"`
	Query            string          `json:"query"`
	FocusMode        string          `json:"focusMode"`
	Engine           string          `json:"engine"`
	EnginesUsed      []string        `json:"enginesUsed"`
	Degraded         bool            `json:"degraded"`
	ScopeFilters     []string        `json:"scopeFilters"`
	RewrittenQueries []string        `json:"rewrittenQueries"`
	StageTimings     *StageTimings   `json:"stageTimings"`
	TraceEvents      []TracePayload  `json:"traceEvents"`
	Sources          []SourceCard    `json:"sources"`
	Report           *string         `json:"report"`
	Citations        []Citation      `json:"citations"`
	Takeaways        []Takeaway      `json:"takeaways"`
	FollowUps        []string        `json:"followUps"`
	Consensus        *Consensus      `json:"consensus"`
	LatencyMs        int64           `json:"latencyMs"`
	TokenStats       *TokenStats     `json:"tokenStats"`
	LLMModel         *string         `json:"llmModel"`
	SourceCount      int             `json:"sourceCount"`
	CharCount        int             `json:"charCount"`
	CacheHit         bool            `json:"cacheHit"`
	CreatedAt        string          `json:"createdAt"`
	UpdatedAt        string          `json:"updatedAt"`
}

// Settings is the first-run / settings form payload (PRODUCT §8). Secrets are
// write-only: SaveSettings accepts them, GetConfig never returns them.
type Settings struct {
	LLMAPIKey    string `json:"llmApiKey,omitempty"`
	TavilyAPIKey string `json:"tavilyApiKey,omitempty"`
}
