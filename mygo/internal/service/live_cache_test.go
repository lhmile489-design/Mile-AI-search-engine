//go:build live

package service

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/lhmile489-design/mile-ai-search/internal/config"
	"github.com/lhmile489-design/mile-ai-search/internal/contract"
	"github.com/lhmile489-design/mile-ai-search/internal/pipeline"
)

// Run: go test -tags=live -run TestLiveCacheTwice -v ./internal/service
// APPDATA points at a temp dir so the real history is untouched.
func TestLiveCacheTwice(t *testing.T) {
	loadBackendEnv(t)
	tmp := t.TempDir()
	t.Setenv("APPDATA", tmp)
	CloseShared()
	t.Cleanup(CloseShared)
	deps := NewDeps(config.Load())

	run := func(label string) {
		var done *contract.DonePayload
		hits := 0
		t0 := time.Now()
		err := pipeline.Run(context.Background(), deps, liveReq(), func(f contract.StreamFrame) error {
			if f.Type == "trace" && f.Trace.CacheHit {
				hits++
			}
			if f.Type == "done" {
				done = f.Done
			}
			if f.Type == "error" {
				t.Errorf("error frame: %+v", *f.Error)
			}
			return nil
		})
		if err != nil || done == nil {
			t.Fatalf("%s: err=%v done=%v", label, err, done != nil)
		}
		hid := "nil"
		if done.HistoryID != nil {
			hid = *done.HistoryID
		}
		t.Logf("%s: cacheHit=%v historyId=%s wall_ms=%d latencyMs=%d timings=%+v firstTokenMs=%v cacheTraces=%d",
			label, done.CacheHit, hid, time.Since(t0).Milliseconds(), done.LatencyMs, done.StageTimings, done.FirstTokenMs, hits)
	}
	run("run1")
	run("run2")

	list, err := SearchService{}.ListHistory(1, 20, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("history total=%d", list.Total)
	for i, c := range list.Records {
		t.Logf("row%d: %+v", i, c)
	}
	if p := filepath.Join(tmp, "MileAISearch", "data"); true {
		es, _ := os.ReadDir(p)
		for _, e := range es {
			t.Logf("db dir entry: %s", e.Name())
		}
	}
}
