//go:build live

package service

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/lhmile489-design/mile-ai-search/internal/config"
	"github.com/lhmile489-design/mile-ai-search/internal/contract"
	"github.com/lhmile489-design/mile-ai-search/internal/pipeline"
)

// G4 task 2: dump the frames of three questions as JSONL, one line per frame:
// {"type":"<event>","data":{...}}. The Python side is captured into the same
// shape by testdata/g4_capture_py.py, and testdata/g4_check.py checks both.
//
// Run: G4_OUT=<dir> go test -tags=live -run TestLiveG4Capture -v -timeout 10m ./internal/service
// APPDATA points at a temp dir so the real history is untouched.
var g4Questions = map[string]string{
	"q1_benchmark": "FlashAttention-3 FP8 benchmark throughput on H100",
	"q2_chinese":   "大模型推理中 KV Cache 量化方法对比",
	"q3_code":      "torch.compile CUDA graphs reduce-overhead example code",
}

func TestLiveG4Capture(t *testing.T) {
	out := os.Getenv("G4_OUT")
	if out == "" {
		t.Skip("G4_OUT not set")
	}
	loadBackendEnv(t)
	t.Setenv("APPDATA", t.TempDir())
	CloseShared()
	t.Cleanup(CloseShared)
	deps := NewDeps(config.Load())

	for name, q := range g4Questions {
		f, err := os.Create(filepath.Join(out, "go_"+name+".jsonl"))
		if err != nil {
			t.Fatal(err)
		}
		req := contract.SearchRequest{Query: q, FocusMode: "web", Engine: "tavily", ScopeFilters: []string{}}
		err = pipeline.Run(context.Background(), deps, req, func(fr contract.StreamFrame) error {
			raw, _ := json.Marshal(fr)
			var m map[string]json.RawMessage
			_ = json.Unmarshal(raw, &m)
			var data json.RawMessage = []byte("null")
			for k, v := range m {
				if k != "type" {
					data = v
				}
			}
			line, _ := json.Marshal(map[string]any{"type": fr.Type, "data": data})
			_, werr := f.Write(append(line, '\n'))
			return werr
		})
		f.Close()
		if err != nil {
			t.Errorf("%s: %v", name, err)
		}
		t.Logf("%s captured", name)
	}
}
