// Package history persists finished searches to SQLite (modernc.org/sqlite,
// pure Go, no cgo). The schema is backend/app/db/migrations/V1__init.sql, so
// a Python-era database and this one are interchangeable. The file lives under
// %APPDATA%\MileAISearch\data, never the install directory.
//
// Every JSON column is bound as a Go string through a "?" placeholder; no SQL
// text is ever built from user data.
package history

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed migrations/V*__*.sql
var migrationFS embed.FS

// ErrNotFound is returned by Get and Delete for an unknown id.
var ErrNotFound = errors.New("history: not found")

// Store is a SQLite-backed history store.
type Store struct {
	db   *sql.DB
	path string
}

// Record is one search_history row. JSON columns hold already-serialized JSON
// text; nullable columns are *string / *int.
type Record struct {
	ID               string
	Query            string
	FocusMode        string
	RequestedEngine  string
	EnginesUsed      string
	Degraded         bool
	ScopeFilters     string
	RewrittenQueries string
	StageTimings     string
	TraceEvents      string
	RawSources       string
	Sources          string
	ReportText       string
	Citations        *string
	Takeaways        *string
	FollowUps        *string
	Consensus        *string
	LatencyMs        int64
	TokenStats       *string
	LLMModel         *string
	SourceCount      int
	CharCount        int
	CacheHit         bool
	CreatedAt        int64 // unix ms
	UpdatedAt        int64
}

// Card is one list row (no report body).
type Card struct {
	ID          string
	Query       string
	FocusMode   string
	Engine      string
	CreatedAt   int64
	SourceCount int
	CharCount   int
	LatencyMs   int64
	CacheHit    bool
}

// DataDir is %APPDATA%\MileAISearch\data ("" when APPDATA is unset).
func DataDir() string {
	dir := os.Getenv("APPDATA")
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, "MileAISearch", "data")
}

// DefaultPath is DataDir()\history.db.
func DefaultPath() (string, error) {
	d := DataDir()
	if d == "" {
		return "", errors.New("history: APPDATA is not set")
	}
	return filepath.Join(d, "history.db"), nil
}

// Open creates the directory, opens the database, and applies pending
// migrations (backing the file up first). It is safe to call repeatedly.
func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("history: create dir: %w", err)
	}
	dsn := "file:" + filepath.ToSlash(path) + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("history: open: %w", err)
	}
	db.SetMaxOpenConns(1) // one local user; serializes writes, avoids SQLITE_BUSY
	s := &Store{db: db, path: path}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

// Close releases the database.
func (s *Store) Close() error { return s.db.Close() }

// Path is the database file.
func (s *Store) Path() string { return s.path }

var migrationName = regexp.MustCompile(`^V(\d+)__.*\.sql$`)

type migration struct {
	version int
	name    string
	sql     string
}

func loadMigrations() ([]migration, error) {
	ents, err := migrationFS.ReadDir("migrations")
	if err != nil {
		return nil, err
	}
	var out []migration
	for _, e := range ents {
		m := migrationName.FindStringSubmatch(e.Name())
		if m == nil {
			continue
		}
		v, _ := strconv.Atoi(m[1])
		b, err := migrationFS.ReadFile("migrations/" + e.Name())
		if err != nil {
			return nil, err
		}
		out = append(out, migration{version: v, name: strings.TrimSuffix(e.Name(), ".sql"), sql: string(b)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].version < out[j].version })
	for i, m := range out {
		if m.version != i+1 {
			return nil, fmt.Errorf("history: migration versions must be 1..N without gaps, got V%d at position %d", m.version, i+1)
		}
	}
	return out, nil
}

func (s *Store) migrate() error {
	ctx := context.Background()
	if _, err := s.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_version (
		version INTEGER PRIMARY KEY, description TEXT NOT NULL, applied_at INTEGER NOT NULL)`); err != nil {
		return fmt.Errorf("history: schema_version: %w", err)
	}
	applied := map[int]bool{}
	rows, err := s.db.QueryContext(ctx, `SELECT version FROM schema_version`)
	if err != nil {
		return fmt.Errorf("history: read schema_version: %w", err)
	}
	for rows.Next() {
		var v int
		if err := rows.Scan(&v); err != nil {
			rows.Close()
			return err
		}
		applied[v] = true
	}
	rows.Close()

	ms, err := loadMigrations()
	if err != nil {
		return err
	}
	for _, m := range ms {
		if applied[m.version] {
			continue
		}
		if err := s.backup(m.version); err != nil {
			return err
		}
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, m.sql); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("history: migration %s failed, rolled back: %w", m.name, err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO schema_version (version, description, applied_at) VALUES (?, ?, ?)`,
			m.version, m.name, time.Now().UnixMilli()); err != nil {
			_ = tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

// backup copies the database file before a migration runs. A brand-new file
// (nothing to lose) is skipped.
func (s *Store) backup(version int) error {
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='table' AND name='search_history'`).Scan(&n); err != nil {
		return err
	}
	if n == 0 {
		return nil
	}
	_, _ = s.db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`)
	src, err := os.Open(s.path)
	if err != nil {
		return fmt.Errorf("history: backup open: %w", err)
	}
	defer src.Close()
	dst, err := os.Create(fmt.Sprintf("%s.bak.V%d", s.path, version))
	if err != nil {
		return fmt.Errorf("history: backup create: %w", err)
	}
	defer dst.Close()
	if _, err := io.Copy(dst, src); err != nil {
		return fmt.Errorf("history: backup copy: %w", err)
	}
	return nil
}

// SchemaVersion returns the highest applied migration, 0 when none.
func (s *Store) SchemaVersion() (int, error) {
	var v sql.NullInt64
	if err := s.db.QueryRow(`SELECT max(version) FROM schema_version`).Scan(&v); err != nil {
		return 0, err
	}
	return int(v.Int64), nil
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

// Insert writes one snapshot. The caller decides what to do with an error;
// see service for the "must not affect the response" rule.
func (s *Store) Insert(ctx context.Context, r Record) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO search_history (
		id, query, focus_mode, requested_engine, engines_used, degraded, scope_filters,
		rewritten_queries, stage_timings, trace_events, raw_sources, sources, report_text,
		citations, takeaways, follow_ups, consensus, latency_ms, token_stats, llm_model,
		source_count, char_count, cache_hit, created_at, updated_at
	) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		r.ID, r.Query, r.FocusMode, r.RequestedEngine, r.EnginesUsed, b2i(r.Degraded), r.ScopeFilters,
		r.RewrittenQueries, r.StageTimings, r.TraceEvents, r.RawSources, r.Sources, r.ReportText,
		r.Citations, r.Takeaways, r.FollowUps, r.Consensus, r.LatencyMs, r.TokenStats, r.LLMModel,
		r.SourceCount, r.CharCount, b2i(r.CacheHit), r.CreatedAt, r.UpdatedAt)
	if err != nil {
		return fmt.Errorf("history insert: %w", err)
	}
	return nil
}

// List returns one page, newest first, and the total row count (for q, the
// count of matching rows). q is matched with LIKE on the query column; %, _
// and \ in q are escaped so they match literally.
func (s *Store) List(ctx context.Context, page, pageSize int, q string) (int, []Card, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 50 {
		pageSize = 50
	}
	where, args := "", []any{}
	if q != "" {
		esc := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q)
		where, args = ` WHERE query LIKE ? ESCAPE '\'`, []any{"%" + esc + "%"}
	}
	var total int
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM search_history`+where, args...).Scan(&total); err != nil {
		return 0, nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, query, focus_mode, requested_engine, created_at,
		source_count, char_count, latency_ms, cache_hit FROM search_history`+where+
		` ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
		append(args, pageSize, (page-1)*pageSize)...)
	if err != nil {
		return 0, nil, err
	}
	defer rows.Close()
	cards := []Card{}
	for rows.Next() {
		var c Card
		var hit int
		if err := rows.Scan(&c.ID, &c.Query, &c.FocusMode, &c.Engine, &c.CreatedAt, &c.SourceCount, &c.CharCount, &c.LatencyMs, &hit); err != nil {
			return 0, nil, err
		}
		c.CacheHit = hit == 1
		cards = append(cards, c)
	}
	return total, cards, rows.Err()
}

// Get returns the full snapshot or ErrNotFound.
func (s *Store) Get(ctx context.Context, id string) (Record, error) {
	var r Record
	var degraded, hit int
	err := s.db.QueryRowContext(ctx, `SELECT id, query, focus_mode, requested_engine, engines_used, degraded,
		scope_filters, rewritten_queries, stage_timings, trace_events, raw_sources, sources, report_text,
		citations, takeaways, follow_ups, consensus, latency_ms, token_stats, llm_model,
		source_count, char_count, cache_hit, created_at, updated_at
		FROM search_history WHERE id = ?`, id).Scan(
		&r.ID, &r.Query, &r.FocusMode, &r.RequestedEngine, &r.EnginesUsed, &degraded,
		&r.ScopeFilters, &r.RewrittenQueries, &r.StageTimings, &r.TraceEvents, &r.RawSources, &r.Sources, &r.ReportText,
		&r.Citations, &r.Takeaways, &r.FollowUps, &r.Consensus, &r.LatencyMs, &r.TokenStats, &r.LLMModel,
		&r.SourceCount, &r.CharCount, &hit, &r.CreatedAt, &r.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Record{}, ErrNotFound
	}
	if err != nil {
		return Record{}, err
	}
	r.Degraded, r.CacheHit = degraded == 1, hit == 1
	return r, nil
}

// Delete removes one row or returns ErrNotFound.
func (s *Store) Delete(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM search_history WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
