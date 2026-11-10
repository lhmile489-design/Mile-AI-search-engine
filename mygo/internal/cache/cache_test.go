package cache

import (
	"encoding/json"
	"os"
	"sync"
	"testing"
	"time"
)

type keyFile struct {
	L2 []struct {
		Query     string   `json:"query"`
		FocusMode string   `json:"focusMode"`
		Engine    string   `json:"engine"`
		Scope     []string `json:"scope"`
		Key       string   `json:"key"`
	} `json:"l2"`
	L1 []struct {
		Engine   string   `json:"engine"`
		Scope    []string `json:"scope"`
		SubQuery string   `json:"subQuery"`
		Key      string   `json:"key"`
	} `json:"l1"`
}

// Expected keys come from the Python functions (testdata/gen_cache.py).
func TestKeysMatchPython(t *testing.T) {
	b, err := os.ReadFile("../pipeline/testdata/python_cache_keys.json")
	if err != nil {
		t.Fatal(err)
	}
	var f keyFile
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	if len(f.L2) == 0 || len(f.L1) == 0 {
		t.Fatal("empty fixture")
	}
	for i, c := range f.L2 {
		if got := L2Key(c.Query, c.FocusMode, c.Engine, c.Scope); got != c.Key {
			t.Errorf("l2[%d] %q: got %s want %s", i, c.Query, got, c.Key)
		}
	}
	for i, c := range f.L1 {
		if got := L1Key(c.Engine, c.Scope, c.SubQuery); got != c.Key {
			t.Errorf("l1[%d] %q: got %s want %s", i, c.SubQuery, got, c.Key)
		}
	}
}

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *clock) add(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

func TestTTLExpiry(t *testing.T) {
	ck := &clock{t: time.Unix(1000, 0)}
	c := NewLRU[int](8, 10*time.Second, ck.now)
	c.Set("a", 1)
	ck.add(9 * time.Second)
	if v, ok := c.Get("a"); !ok || v != 1 {
		t.Fatalf("before TTL: %v %v", v, ok)
	}
	ck.add(2 * time.Second) // 11s after Set (Get does not extend TTL)
	if _, ok := c.Get("a"); ok {
		t.Fatal("entry should have expired")
	}
	if c.Len() != 0 {
		t.Fatalf("expired entry not dropped, len=%d", c.Len())
	}
}

func TestLRUEviction(t *testing.T) {
	c := NewLRU[int](2, time.Hour, nil)
	c.Set("a", 1)
	c.Set("b", 2)
	c.Get("a") // a is now most recent
	c.Set("c", 3)
	if _, ok := c.Get("b"); ok {
		t.Fatal("b should have been evicted")
	}
	if _, ok := c.Get("a"); !ok {
		t.Fatal("a should survive")
	}
	if c.Len() != 2 {
		t.Fatalf("len %d", c.Len())
	}
}

func TestLastWriteWins(t *testing.T) {
	c := NewLRU[int](4, time.Hour, nil)
	var wg sync.WaitGroup
	for i := 1; i <= 20; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); c.Set("k", i) }()
	}
	wg.Wait()
	if _, ok := c.Get("k"); !ok || c.Len() != 1 {
		t.Fatalf("len %d", c.Len())
	}
}

func TestDisabledStoreCachesNothing(t *testing.T) {
	s := NewStore[int, string](false, 4, time.Hour, nil)
	s.SetL1("k", 1)
	s.SetL2("k", "v")
	if _, ok := s.GetL1("k"); ok {
		t.Fatal("L1 cached while disabled")
	}
	if _, ok := s.GetL2("k"); ok {
		t.Fatal("L2 cached while disabled")
	}
	on := NewStore[int, string](true, 4, time.Hour, nil)
	on.SetL2("k", "v")
	if v, ok := on.GetL2("k"); !ok || v != "v" {
		t.Fatal("enabled store should cache")
	}
}
