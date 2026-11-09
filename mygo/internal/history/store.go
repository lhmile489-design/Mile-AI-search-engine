// Package history persists search runs to SQLite (modernc.org/sqlite, pure
// Go — no cgo). The database file lives under %APPDATA%\MileAISearch, never
// the install directory.
package history

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// Store is a SQLite-backed history store.
type Store struct {
	db *sql.DB
}

// DefaultPath returns %APPDATA%\MileAISearch\history.db on Windows, or the
// XDG/home equivalent elsewhere.
func DefaultPath() (string, error) {
	if dir := os.Getenv("APPDATA"); dir != "" {
		return filepath.Join(dir, "MileAISearch", "history.db"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".mileaisearch", "history.db"), nil
}

// Open creates the parent directory and opens (creating if needed) the DB at
// path, enabling WAL.
func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) migrate() error {
	_, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS runs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		query TEXT NOT NULL,
		report TEXT,
		created_at INTEGER NOT NULL
	)`)
	return err
}

// Add inserts a run and returns its id.
func (s *Store) Add(query, report string, createdAt int64) (int64, error) {
	res, err := s.db.Exec(`INSERT INTO runs (query, report, created_at) VALUES (?,?,?)`,
		query, report, createdAt)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// Get returns a run's query and report.
func (s *Store) Get(id int64) (query, report string, createdAt int64, err error) {
	err = s.db.QueryRow(`SELECT query, report, created_at FROM runs WHERE id=?`, id).
		Scan(&query, &report, &createdAt)
	return
}

// List returns up to n recent runs (id, query, created_at), newest first.
func (s *Store) List(n int) ([]struct{ ID int64; Query string; CreatedAt int64 }, error) {
	rows, err := s.db.Query(`SELECT id, query, created_at FROM runs ORDER BY id DESC LIMIT ?`, n)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []struct{ ID int64; Query string; CreatedAt int64 }
	for rows.Next() {
		var r struct{ ID int64; Query string; CreatedAt int64 }
		if err := rows.Scan(&r.ID, &r.Query, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// Count returns the number of runs (for tests).
func (s *Store) Count() (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM runs`).Scan(&n)
	return n, err
}

// Close closes the DB.
func (s *Store) Close() error { return s.db.Close() }

var _ = fmt.Sprintf // keep fmt import if unused later
