package textutil

import "testing"

func TestUTF16Len(t *testing.T) {
	cases := []struct {
		in   string
		want int
	}{
		{"", 0},
		{"hello", 5},          // ASCII: 1 unit each
		{"研究结果显示", 6},     // CJK in BMP: 1 unit each
		{"a😀b", 4},            // emoji > U+FFFF: 2 units
		{"😀😀", 4},            // two surrogate pairs
		{"中😀a", 4},           // mixed: 1+2+1
	}
	for _, c := range cases {
		if got := utf16Len(c.in); got != c.want {
			t.Errorf("utf16Len(%q)=%d want %d", c.in, got, c.want)
		}
	}
}

func TestUTF16Offsets(t *testing.T) {
	// "a😀中" : runes at index 0,1,2; UTF-16 offsets 0,1,3,4.
	off := UTF16Offsets("a😀中")
	want := []int{0, 1, 3, 4}
	if len(off) != len(want) {
		t.Fatalf("len=%d want %d", len(off), len(want))
	}
	for i := range want {
		if off[i] != want[i] {
			t.Errorf("off[%d]=%d want %d", i, off[i], want[i])
		}
	}
}

// The marker offsets must equal what Python's parse_citations produced, so the
// page's String.slice lands on the same characters.
func TestMarkerOffsetsMatchPython(t *testing.T) {
	// ASCII: "See result " is 11 runes, all BMP → markerStart 11, end 14.
	off := UTF16Offsets("See result [1] here.")
	if off[11] != 11 || off[14] != 14 {
		t.Errorf("ascii marker: start=%d end=%d want 11/14", off[11], off[14])
	}
	// CJK: "研究结果显示 " is 7 runes all BMP → markerStart 7, end 10.
	off = UTF16Offsets("研究结果显示 [1] 性能提升。")
	if off[7] != 7 || off[10] != 10 {
		t.Errorf("cjk marker: start=%d end=%d want 7/10", off[7], off[10])
	}
	// Emoji before marker shifts later offsets by 2.
	// "😀a" = offsets 0,2,3 → rune index 2 is at UTF-16 3.
	off = UTF16Offsets("😀a")
	if off[2] != 3 {
		t.Errorf("emoji: off[2]=%d want 3", off[2])
	}
}
