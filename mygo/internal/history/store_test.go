package history

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func sp(s string) *string { return &s }

func sample(id string, created int64) Record {
	return Record{
		ID: id, Query: "FlashAttention-3 \U0001F600 吞吐", FocusMode: "web", RequestedEngine: "tavily",
		EnginesUsed: `["tavily"]`, Degraded: true, ScopeFilters: `["preprint"]`,
		RewrittenQueries: `["a","b"]`, StageTimings: `{"rewritingMs":1,"firstTokenMs":5}`,
		TraceEvents: `[{"step":"rewriting","status":"end","cacheHit":false}]`, RawSources: `[]`,
		Sources: `[{"index":1,"url":"https://x.y/z"}]`, ReportText: "# 研报\n正文 [1]",
		Citations: sp(`[{"index":1}]`), Takeaways: sp(`[]`), FollowUps: sp(`["q1"]`),
		Consensus: nil, LatencyMs: 1234, TokenStats: sp(`{"calls":2}`), LLMModel: sp("m"),
		SourceCount: 1, CharCount: 9, CacheHit: false, CreatedAt: created, UpdatedAt: created,
	}
}

func openTemp(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "data", "history.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestInsertGetRoundTrip(t *testing.T) {
	s := openTemp(t)
	ctx := context.Background()
	in := sample("hist_1_aaaaaaaa", 1000)
	if err := s.Insert(ctx, in); err != nil {
		t.Fatal(err)
	}
	got, err := s.Get(ctx, in.ID)
	if err != nil {
		t.Fatal(err)
	}
	// NULL columns must stay NULL, not become "" or "null".
	if got.Consensus != nil {
		t.Errorf("consensus should be NULL, got %q", *got.Consensus)
	}
	got.Consensus = in.Consensus
	if got.Query != in.Query || got.ReportText != in.ReportText || !got.Degraded ||
		got.Sources != in.Sources || got.TraceEvents != in.TraceEvents || got.StageTimings != in.StageTimings ||
		*got.Citations != *in.Citations || *got.LLMModel != "m" || got.LatencyMs != 1234 ||
		got.SourceCount != 1 || got.CharCount != 9 || got.CreatedAt != 1000 || got.CacheHit {
		t.Fatalf("round trip mismatch:\n got %+v\nwant %+v", got, in)
	}
}

func TestReplayRowKeepsCacheHitAndParsableTrace(t *testing.T) {
	s := openTemp(t)
	ctx := context.Background()
	r := sample("hist_2_bbbbbbbb", 2000)
	r.CacheHit = true
	trace := []map[string]any{{"step": "rewriting", "status": "start", "cacheHit": true}, {"step": "generating", "status": "end", "cacheHit": true}}
	b, _ := json.Marshal(trace)
	r.TraceEvents = string(b)
	if err := s.Insert(ctx, r); err != nil {
		t.Fatal(err)
	}
	got, _ := s.Get(ctx, r.ID)
	if !got.CacheHit {
		t.Fatal("cache_hit lost")
	}
	var back []map[string]any
	if err := json.Unmarshal([]byte(got.TraceEvents), &back); err != nil || len(back) != 2 {
		t.Fatalf("trace_events not a parsable 2-item array: %v %q", err, got.TraceEvents)
	}
}

func TestListOrderPagingSearchDelete(t *testing.T) {
	s := openTemp(t)
	ctx := context.Background()
	for i, id := range []string{"hist_a", "hist_b", "hist_c"} {
		r := sample(id, int64(100*(i+1)))
		r.Query = []string{"alpha", "beta 100%", "gamma_x"}[i]
		if err := s.Insert(ctx, r); err != nil {
			t.Fatal(err)
		}
	}
	total, cards, _ := s.List(ctx, 1, 2, "")
	if total != 3 || len(cards) != 2 || cards[0].ID != "hist_c" || cards[1].ID != "hist_b" {
		t.Fatalf("page1 total=%d %+v", total, cards)
	}
	_, p2, _ := s.List(ctx, 2, 2, "")
	if len(p2) != 1 || p2[0].ID != "hist_a" {
		t.Fatalf("page2 %+v", p2)
	}
	// LIKE wildcards in q are literal.
	if n, c, _ := s.List(ctx, 1, 20, "%"); n != 1 || c[0].ID != "hist_b" {
		t.Fatalf("q=%% matched %d %+v", n, c)
	}
	if n, c, _ := s.List(ctx, 1, 20, "_"); n != 1 || c[0].ID != "hist_c" {
		t.Fatalf("q=_ matched %d %+v", n, c)
	}
	if err := s.Delete(ctx, "hist_b"); err != nil {
		t.Fatal(err)
	}
	total, cards, _ = s.List(ctx, 1, 20, "")
	for _, c := range cards {
		if c.ID == "hist_b" {
			t.Fatal("deleted item still listed")
		}
	}
	if total != 2 {
		t.Fatalf("total after delete %d", total)
	}
	if err := s.Delete(ctx, "hist_b"); err != ErrNotFound {
		t.Fatalf("second delete: %v", err)
	}
	if _, err := s.Get(ctx, "hist_b"); err != ErrNotFound {
		t.Fatalf("get deleted: %v", err)
	}
}

func TestInsertRejectsBadRow(t *testing.T) {
	s := openTemp(t)
	r := sample("not_hist", 1) // violates CHECK (substr(id,1,5)='hist_')
	if err := s.Insert(context.Background(), r); err == nil {
		t.Fatal("expected a constraint error")
	}
}

func TestMigrationIdempotentAndBackup(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data", "history.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Insert(context.Background(), sample("hist_keep", 5)); err != nil {
		t.Fatal(err)
	}
	if v, _ := s.SchemaVersion(); v != 1 {
		t.Fatalf("version %d", v)
	}
	_ = s.Close()
	for i := 0; i < 2; i++ { // reopen twice: no error, no duplicate version row, data kept
		s, err = Open(path)
		if err != nil {
			t.Fatalf("reopen %d: %v", i, err)
		}
		if _, err := s.Get(context.Background(), "hist_keep"); err != nil {
			t.Fatalf("data lost after reopen: %v", err)
		}
		var n int
		_ = s.db.QueryRow(`SELECT count(*) FROM schema_version`).Scan(&n)
		if n != 1 {
			t.Fatalf("schema_version rows %d", n)
		}
		_ = s.Close()
	}
	// A pre-existing table with an unapplied version triggers a backup file.
	s, _ = Open(path)
	_, _ = s.db.Exec(`DELETE FROM schema_version`)
	_ = s.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatalf("re-apply V1 over existing tables: %v", err)
	}
	_ = s.Close()
	if _, err := os.Stat(path + ".bak.V1"); err != nil {
		t.Fatalf("backup missing: %v", err)
	}
}

func TestDefaultPathUnderAppData(t *testing.T) {
	t.Setenv("APPDATA", filepath.Join(t.TempDir(), "Roaming"))
	p, err := DefaultPath()
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(os.Getenv("APPDATA"), "MileAISearch", "data")
	if !strings.HasPrefix(p, want) || filepath.Base(p) != "history.db" {
		t.Fatalf("path %q not under %q", p, want)
	}
	t.Setenv("APPDATA", "")
	if _, err := DefaultPath(); err == nil {
		t.Fatal("expected an error without APPDATA")
	}
}
