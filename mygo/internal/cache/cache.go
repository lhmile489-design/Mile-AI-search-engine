// Package cache holds the two in-process caches of the pipeline (contract §11):
// L1 keeps the raw results of one sub-query, L2 keeps the whole product of a
// run that reached done. Both are LRU with a TTL. Keys follow
// backend/app/pipeline/_cache.py so the two implementations agree.
package cache

import (
	"container/list"
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/text/unicode/norm"
)

const (
	DefaultTTL     = 600 * time.Second
	DefaultMaxSize = 128
)

// L2Key is sha256(NFC(strip(lower(query))) NUL focusMode NUL engine NUL sorted(scope)...).
func L2Key(query, focusMode, engine string, scope []string) string {
	q := norm.NFC.String(strings.ToLower(strings.TrimSpace(query)))
	parts := append([]string{q, focusMode, engine}, sortedCopy(scope)...)
	return digest(parts)
}

// L1Key is sha256(engine NUL sorted(scope)... NUL strip(subQuery)).
func L1Key(engine string, scope []string, subQuery string) string {
	parts := append([]string{engine}, sortedCopy(scope)...)
	parts = append(parts, strings.TrimSpace(subQuery))
	return digest(parts)
}

func sortedCopy(in []string) []string {
	out := append([]string(nil), in...)
	sort.Strings(out)
	return out
}

func digest(parts []string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return hex.EncodeToString(sum[:])
}

type entry[V any] struct {
	key    string
	val    V
	expire time.Time
}

// LRU is a TTL-bound least-recently-used map, safe for concurrent use.
// Concurrent writers to the same key simply overwrite: last write wins.
type LRU[V any] struct {
	mu    sync.Mutex
	max   int
	ttl   time.Duration
	now   func() time.Time
	order *list.List // front = most recent
	items map[string]*list.Element
}

// NewLRU builds a cache. now may be nil (time.Now); tests inject a fake clock.
func NewLRU[V any](max int, ttl time.Duration, now func() time.Time) *LRU[V] {
	if max <= 0 {
		max = DefaultMaxSize
	}
	if ttl <= 0 {
		ttl = DefaultTTL
	}
	if now == nil {
		now = time.Now
	}
	return &LRU[V]{max: max, ttl: ttl, now: now, order: list.New(), items: map[string]*list.Element{}}
}

// Get returns the value when present and not expired, and marks it recent.
func (c *LRU[V]) Get(key string) (V, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	var zero V
	el, ok := c.items[key]
	if !ok {
		return zero, false
	}
	e := el.Value.(*entry[V])
	if c.now().After(e.expire) {
		c.order.Remove(el)
		delete(c.items, key)
		return zero, false
	}
	c.order.MoveToFront(el)
	return e.val, true
}

// Set stores val, evicting the least recently used entry when full.
func (c *LRU[V]) Set(key string, val V) {
	c.mu.Lock()
	defer c.mu.Unlock()
	exp := c.now().Add(c.ttl)
	if el, ok := c.items[key]; ok {
		e := el.Value.(*entry[V])
		e.val, e.expire = val, exp
		c.order.MoveToFront(el)
		return
	}
	if c.order.Len() >= c.max {
		if back := c.order.Back(); back != nil {
			c.order.Remove(back)
			delete(c.items, back.Value.(*entry[V]).key)
		}
	}
	c.items[key] = c.order.PushFront(&entry[V]{key: key, val: val, expire: exp})
}

// Len is the number of stored entries (expired ones included until touched).
func (c *LRU[V]) Len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.order.Len()
}

// Store pairs the L1 and L2 caches behind one CACHE_ENABLED switch.
type Store[L1 any, L2 any] struct {
	Enabled bool
	l1      *LRU[L1]
	l2      *LRU[L2]
}

// NewStore builds both caches with the same size and TTL.
func NewStore[L1 any, L2 any](enabled bool, max int, ttl time.Duration, now func() time.Time) *Store[L1, L2] {
	return &Store[L1, L2]{Enabled: enabled, l1: NewLRU[L1](max, ttl, now), l2: NewLRU[L2](max, ttl, now)}
}

func (s *Store[L1, L2]) GetL1(key string) (v L1, ok bool) {
	if s == nil || !s.Enabled {
		return v, false
	}
	return s.l1.Get(key)
}

func (s *Store[L1, L2]) SetL1(key string, v L1) {
	if s != nil && s.Enabled {
		s.l1.Set(key, v)
	}
}

func (s *Store[L1, L2]) GetL2(key string) (v L2, ok bool) {
	if s == nil || !s.Enabled {
		return v, false
	}
	return s.l2.Get(key)
}

func (s *Store[L1, L2]) SetL2(key string, v L2) {
	if s != nil && s.Enabled {
		s.l2.Set(key, v)
	}
}
