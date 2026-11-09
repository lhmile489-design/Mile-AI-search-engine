package textutil

import "unicode"

// abbreviations that keep an English period from ending a sentence.
var abbrevs = []string{
	"e.g", "i.e", "vs", "et al", "etc", "fig", "eq", "sec",
	"ref", "approx", "dept", "mr", "dr", "prof", "no",
}

var zhPunct = map[rune]bool{'。': true, '！': true, '？': true}
var enQuestionExclaim = map[rune]bool{'!': true, '?': true}
var sentPunct = map[rune]bool{'.': true, '!': true, '?': true, '。': true, '！': true, '？': true}

// isEnSentenceEnd reports whether the '.' at rune index dotPos ends a sentence.
// It excludes decimals (1.3), version numbers (v1.0.2), and abbreviations.
func isEnSentenceEnd(rs []rune, dotPos int) bool {
	var before, after rune
	if dotPos > 0 {
		before = rs[dotPos-1]
	}
	if dotPos+1 < len(rs) {
		after = rs[dotPos+1]
	}
	if unicode.IsDigit(before) && unicode.IsDigit(after) {
		return false
	}
	if unicode.IsDigit(after) {
		return false
	}
	// Abbreviation check: does the text right before the period end in one?
	start := dotPos - 8
	if start < 0 {
		start = 0
	}
	ctx := trimRightSpace(string(rs[start:dotPos]))
	for _, ab := range abbrevs {
		if endsWithFold(ctx, ab) {
			return false
		}
	}
	if after != 0 && !isAfterSentEnd(after) {
		return false
	}
	return true
}

func isAfterSentEnd(r rune) bool {
	switch r {
	case ' ', '\t', '\n', '"', '\'', ')', ']', '}':
		return true
	}
	return false
}

func trimRightSpace(s string) string {
	for len(s) > 0 && (s[len(s)-1] == ' ' || s[len(s)-1] == '\t' || s[len(s)-1] == '\n') {
		s = s[:len(s)-1]
	}
	return s
}

func endsWithFold(s, suffix string) bool {
	if len(s) < len(suffix) {
		return false
	}
	return lowerASCII(s[len(s)-len(suffix):]) == suffix
}

func lowerASCII(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 32
		}
	}
	return string(b)
}

// Sentence is a (start, end) rune-index range, end exclusive, including the
// trailing punctuation — the rune analogue of finalizer.split_sentences.
type Sentence struct {
	Start, End int
}

// SplitSentences cuts text into sentences, returning rune-index ranges.
// Chinese 。！？ and English !? always end a sentence; '.' goes through
// isEnSentenceEnd to skip decimals, versions, and abbreviations.
func SplitSentences(text string) []Sentence {
	if text == "" {
		return nil
	}
	rs := runes(text)
	var breaks []int
	i := 0
	for i < len(rs) {
		ch := rs[i]
		end := false
		if zhPunct[ch] || enQuestionExclaim[ch] {
			end = true
		} else if ch == '.' {
			end = isEnSentenceEnd(rs, i)
		}
		if end {
			j := i + 1
			for j < len(rs) && sentPunct[rs[j]] {
				j++
			}
			breaks = append(breaks, j)
			i = j
		} else {
			i++
		}
	}
	if len(breaks) == 0 {
		return []Sentence{{0, len(rs)}}
	}
	var out []Sentence
	start := 0
	for _, bp := range breaks {
		if bp > start {
			out = append(out, Sentence{start, bp})
		}
		next := bp
		for next < len(rs) && (rs[next] == ' ' || rs[next] == '\t' || rs[next] == '\n') {
			next++
		}
		start = next
	}
	if start < len(rs) {
		out = append(out, Sentence{start, len(rs)})
	}
	return out
}
