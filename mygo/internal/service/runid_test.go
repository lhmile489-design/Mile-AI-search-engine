package service

import (
	"context"
	"testing"
)

func TestRegisterRunRejectsBadIDs(t *testing.T) {
	for _, id := range []string{"", "all"} {
		release, rej := registerRun(id, func() {})
		if rej == "" || release != nil {
			t.Errorf("id %q: want rejection, got release=%v rej=%q", id, release != nil, rej)
		}
	}
}

func TestRegisterRunRejectsDuplicate(t *testing.T) {
	rel, rej := registerRun("dup-1", func() {})
	if rej != "" {
		t.Fatalf("first register: %s", rej)
	}
	defer rel()
	if _, rej := registerRun("dup-1", func() {}); rej == "" {
		t.Errorf("duplicate id must be rejected")
	}
}

// Two consecutive searches: canceling the first must not touch the second.
func TestCancelFirstDoesNotAffectSecond(t *testing.T) {
	ctx1, cancel1 := context.WithCancel(context.Background())
	ctx2, cancel2 := context.WithCancel(context.Background())
	defer cancel1()
	defer cancel2()

	rel1, rej := registerRun("run-a", cancel1)
	if rej != "" {
		t.Fatal(rej)
	}
	rel2, rej := registerRun("run-b", cancel2)
	if rej != "" {
		t.Fatal(rej)
	}
	defer rel2()

	if err := (SearchService{}).Cancel("run-a"); err != nil {
		t.Fatal(err)
	}
	if ctx1.Err() == nil {
		t.Errorf("first run should be canceled")
	}
	if ctx2.Err() != nil {
		t.Errorf("second run must keep running, got %v", ctx2.Err())
	}

	// A stale Cancel for a finished run must not hit a newer run.
	rel1()
	_ = (SearchService{}).Cancel("run-a")
	if ctx2.Err() != nil {
		t.Errorf("stale cancel hit the second run")
	}

	// "all" is the window-close path.
	_ = (SearchService{}).Cancel("all")
	if ctx2.Err() == nil {
		t.Errorf("cancel all should cancel the second run")
	}
}

func TestCancelEmptyAndUnknownCancelNothing(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	rel, rej := registerRun("run-c", cancel)
	if rej != "" {
		t.Fatal(rej)
	}
	defer rel()
	_ = (SearchService{}).Cancel("")
	_ = (SearchService{}).Cancel("nope")
	if ctx.Err() != nil {
		t.Errorf("empty or unknown id must cancel nothing")
	}
}
