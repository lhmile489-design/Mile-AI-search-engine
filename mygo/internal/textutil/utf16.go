// Package textutil provides UTF-16 code-unit offset math and sentence
// splitting for citation parsing, mirroring backend/app/pipeline/finalizer.py.
// All citation offsets are UTF-16 code units so the page can slice strings with
// JavaScript's String.slice. Go strings are UTF-8 bytes, so every code point
// above U+FFFF counts as two units.
package textutil

// utf16Len returns the number of UTF-16 code units in s.
func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		if r > 0xFFFF {
			n += 2
		} else {
			n++
		}
	}
	return n
}

// UTF16Offsets returns, for each rune index in s, the UTF-16 code-unit offset
// at which that rune begins. The result has length runeCount(s)+1; the last
// element is the total code-unit length. Index a rune position to get its
// UTF-16 offset, exactly like finalizer._utf16_offsets.
func UTF16Offsets(s string) []int {
	offsets := make([]int, 0, len(s)+1)
	offsets = append(offsets, 0)
	cur := 0
	for _, r := range s {
		if r > 0xFFFF {
			cur += 2
		} else {
			cur++
		}
		offsets = append(offsets, cur)
	}
	return offsets
}

// runes decodes s once for index-based access (split_sentences works on rune
// positions, matching Python's per-character indexing).
func runes(s string) []rune { return []rune(s) }
