package pipeline

import (
	"context"
	"log"
	"sort"
	"sync"
	"time"

	"github.com/lhmile489-design/mile-ai-search/internal/cache"
	"github.com/lhmile489-design/mile-ai-search/internal/contract"
	"github.com/lhmile489-design/mile-ai-search/internal/provider"
)

// Batch is the outcome of one sub-query.
type Batch struct {
	Index    int
	Engine   string // engine that produced the results; "none" when both failed
	Sources  []provider.Source
	Degraded bool // primary failed, fallback answered
	CacheHit bool // served from the L1 cache
}

// SearchPlan is the retrieval input.
type SearchPlan struct {
	Primary  provider.Provider
	Fallback provider.Provider // may be nil
	Queries  []string
	Scope    []string
	Timeout  time.Duration
	Cache    *CacheStore // optional L1
	Engine   string      // requested engine, part of the L1 key
}

// RawCard converts a hit to the trimmed phase=raw card.
func RawCard(s provider.Source) contract.RawSource {
	return contract.RawSource{
		ID: s.ID, Title: s.Title, URL: s.URL, Domain: s.Domain,
		FaviconURL: s.FaviconURL, Engine: s.Engine,
		Category: s.Category, CategorySource: s.CategorySource,
		PublishedAt: s.PublishedAt,
	}
}

func searchOne(ctx context.Context, plan SearchPlan, idx int, q string) Batch {
	l1Key := cache.L1Key(plan.Engine, plan.Scope, q)
	if e, ok := plan.Cache.GetL1(l1Key); ok {
		src := cloneSources(e.Sources)
		for i := range src {
			src[i].MatchedQueries = []int{idx}
		}
		// the engine stays the real one; the hit is reported via trace cacheHit
		return Batch{Index: idx, Engine: e.Engine, Sources: src, CacheHit: true}
	}
	exclude := provider.ExcludeCategories(plan.Scope)
	try := func(p provider.Provider) ([]provider.Source, error) {
		cctx, cancel := context.WithTimeout(ctx, plan.Timeout)
		defer cancel()
		res, err := p.Search(cctx, q, 10, exclude)
		if err != nil {
			return nil, err
		}
		for i := range res {
			res[i].MatchedQueries = []int{idx}
		}
		return res, nil
	}

	res, err := try(plan.Primary)
	if err == nil {
		plan.Cache.SetL1(l1Key, L1Entry{Engine: plan.Primary.Name(), Sources: cloneSources(res)})
		return Batch{Index: idx, Engine: plan.Primary.Name(), Sources: res}
	}
	if ctx.Err() != nil {
		return Batch{Index: idx, Engine: "none"}
	}
	log.Printf("search: primary %s failed for query %d: %v", plan.Primary.Name(), idx, err)
	if plan.Fallback != nil {
		res, err = try(plan.Fallback)
		if err == nil {
			plan.Cache.SetL1(l1Key, L1Entry{Engine: plan.Fallback.Name(), Sources: cloneSources(res)})
			return Batch{Index: idx, Engine: plan.Fallback.Name(), Sources: res, Degraded: true}
		}
		if ctx.Err() == nil {
			log.Printf("search: fallback %s failed for query %d: %v", plan.Fallback.Name(), idx, err)
		}
	}
	return Batch{Index: idx, Engine: "none"}
}

// SearchAll runs every sub-query concurrently and delivers each batch to
// onBatch as it completes (serialized, so the caller needs no locking). It
// returns how many goroutines were still in flight when ctx was canceled, or
// zero on a normal finish. onBatch returning false stops delivery.
func SearchAll(ctx context.Context, plan SearchPlan, onBatch func(Batch) bool) (canceled int) {
	ch := make(chan Batch, len(plan.Queries))
	var wg sync.WaitGroup
	var mu sync.Mutex
	finished := 0
	for i, q := range plan.Queries {
		wg.Add(1)
		go func() {
			defer wg.Done()
			b := searchOne(ctx, plan, i, q)
			mu.Lock()
			finished++
			mu.Unlock()
			ch <- b
		}()
	}
	go func() { wg.Wait(); close(ch) }()

	delivered := 0
	for delivered < len(plan.Queries) {
		select {
		case b, ok := <-ch:
			if !ok {
				return 0
			}
			delivered++
			if !onBatch(b) {
				return len(plan.Queries) - delivered
			}
		case <-ctx.Done():
			// The goroutines see the same ctx and unwind on their own; wait
			// so no external call outlives this function.
			wg.Wait()
			mu.Lock()
			defer mu.Unlock()
			return len(plan.Queries) - delivered
		}
	}
	return 0
}

// EnginesUsed returns the sorted distinct engines that returned results.
func EnginesUsed(batches []Batch) []string {
	set := map[string]bool{}
	for _, b := range batches {
		if len(b.Sources) > 0 {
			set[b.Engine] = true
		}
	}
	out := make([]string, 0, len(set))
	for e := range set {
		out = append(out, e)
	}
	sort.Strings(out)
	return out
}
