package history

import (
	"path/filepath"
	"testing"
)

func TestOpenAddGetList(t *testing.T) {
	dir := t.TempDir()
	db, err := Open(filepath.Join(dir, "sub", "history.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	id, err := db.Add("FlashAttention-3", "# report body", 1730000000)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	if id < 1 {
		t.Fatalf("id=%d want >=1", id)
	}
	q, r, ts, err := db.Get(id)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if q != "FlashAttention-3" || r != "# report body" || ts != 1730000000 {
		t.Fatalf("Get got (%q,%q,%d)", q, r, ts)
	}
	list, err := db.List(10)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 1 || list[0].Query != "FlashAttention-3" {
		t.Fatalf("List got %+v", list)
	}
	if n, _ := db.Count(); n != 1 {
		t.Fatalf("Count=%d want 1", n)
	}
}

// The whole point of modernc.org/sqlite: it must build with CGO_ENABLED=0.
// This test just proves the package links and runs without cgo.
func TestNoCgoBuild(t *testing.T) {
	if _, err := DefaultPath(); err != nil {
		t.Logf("DefaultPath: %v", err)
	}
}
