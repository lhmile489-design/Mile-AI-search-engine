package textutil

import "testing"

// Mirror of backend/tests/test_finalizer.py TestSplitSentences.
func TestSplitSentences(t *testing.T) {
	cases := []struct {
		name string
		in   string
		minN int
	}{
		{"basic", "Hello world. This is a test.", 2},
		{"chinese", "这是第一句。这是第二句！", 2},
		{"empty", "", 0},
		{"no punct", "no punctuation here", 1},
		{"decimal not end", "version is 1.3 stable now.", 1},
		{"version not end", "use v1.0.2 today.", 1},
		{"exclaim", "wow! amazing!", 2},
	}
	for _, c := range cases {
		got := SplitSentences(c.in)
		if c.minN == 0 {
			if got != nil {
				t.Errorf("%s: want nil got %v", c.name, got)
			}
			continue
		}
		if len(got) < c.minN {
			t.Errorf("%s: len=%d want >=%d (%v)", c.name, len(got), c.minN, got)
		}
	}
}

func TestSplitSentencesOffsets(t *testing.T) {
	// "Hello world. This is a test." → two sentences, second starts at 13.
	s := SplitSentences("Hello world. This is a test.")
	if len(s) != 2 {
		t.Fatalf("len=%d want 2: %v", len(s), s)
	}
	if s[0].Start != 0 || s[0].End != 12 {
		t.Errorf("s[0]=%+v want {0 12}", s[0])
	}
	if s[1].Start != 13 || s[1].End != 28 {
		t.Errorf("s[1]=%+v want {13 28}", s[1])
	}
}
