package pipeline

import (
	"math"
	"strconv"
	"strings"

	"github.com/lhmile489-design/mile-ai-search/internal/contract"
	"github.com/lhmile489-design/mile-ai-search/internal/textutil"
)

// highlightThreshold is the minimum word-overlap score for a highlight.
const highlightThreshold = 0.1

func round4(v float64) float64 { return math.Round(v*10000) / 10000 }

// findMarkers returns every "[digits]" occurrence as rune-index ranges, the
// analogue of re.finditer(r"\[(\d+)\]"). n is -1 when the digits overflow int.
type marker struct{ start, end, n int }

func findMarkers(rs []rune) []marker {
	var out []marker
	for i := 0; i < len(rs); i++ {
		if rs[i] != '[' {
			continue
		}
		j := i + 1
		for j < len(rs) && rs[j] >= '0' && rs[j] <= '9' {
			j++
		}
		if j == i+1 || j >= len(rs) || rs[j] != ']' {
			continue
		}
		n, err := strconv.Atoi(string(rs[i+1 : j]))
		if err != nil {
			n = -1
		}
		out = append(out, marker{start: i, end: j + 1, n: n})
		i = j
	}
	return out
}

func isCJK(r rune) bool {
	return (r >= 0x4e00 && r <= 0x9fff) || (r >= 0x3040 && r <= 0x30ff) || (r >= 0xac00 && r <= 0xd7af)
}

// tokenize returns the set of ASCII words (lowercased) plus CJK bigrams.
func tokenize(text string) map[string]struct{} {
	set := map[string]struct{}{}
	var word []rune
	flush := func() {
		if len(word) > 0 {
			set[string(word)] = struct{}{}
			word = word[:0]
		}
	}
	var cjk []rune
	for _, r := range text {
		switch {
		case r >= 'A' && r <= 'Z':
			word = append(word, r+32)
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			word = append(word, r)
		default:
			flush()
		}
		if isCJK(r) {
			cjk = append(cjk, r)
		}
	}
	flush()
	for i := 0; i+1 < len(cjk); i++ {
		set[string([]rune{cjk[i], cjk[i+1]})] = struct{}{}
	}
	return set
}

// overlapScore is |A intersect B| / |A| with a as the denominator.
func overlapScore(a, b string) float64 {
	ta := tokenize(a)
	if len(ta) == 0 {
		return 0
	}
	tb := tokenize(b)
	hit := 0
	for k := range ta {
		if _, ok := tb[k]; ok {
			hit++
		}
	}
	return float64(hit) / float64(len(ta))
}

// FindHighlight locates the passage sentence that best overlaps query, with
// UTF-16 offsets inside passage. nil when nothing beats the threshold.
func FindHighlight(query, passage string, threshold float64) *contract.HighlightRange {
	sents := textutil.SplitSentences(passage)
	if len(sents) == 0 {
		return nil
	}
	rs := []rune(passage)
	u := textutil.UTF16Offsets(passage)
	best := threshold
	var pick *textutil.Sentence
	for i := range sents {
		s := sents[i]
		sc := overlapScore(query, string(rs[s.Start:s.End]))
		if sc > best {
			best = sc
			pick = &sents[i]
		}
	}
	if pick == nil {
		return nil
	}
	return &contract.HighlightRange{Start: u[pick.Start], End: u[pick.End], Score: round4(best)}
}

// ParseCitations resolves every [n] in report against the ranked sources.
// Offsets are UTF-16 code units. hallucinated lists numbers outside 1..len(sources).
func ParseCitations(report string, sources []contract.SourceCard) (cits []contract.Citation, hallucinated []int) {
	cits = []contract.Citation{}
	hallucinated = []int{}
	rs := []rune(report)
	u := textutil.UTF16Offsets(report)
	sents := textutil.SplitSentences(report)
	charToSent := make([]int, len(rs))
	for i := range charToSent {
		charToSent[i] = -1
	}
	for si, s := range sents {
		for ci := s.Start; ci < s.End; ci++ {
			charToSent[ci] = si
		}
	}
	byIndex := map[int]contract.SourceCard{}
	for _, s := range sources {
		if s.Index != nil {
			byIndex[*s.Index] = s
		}
	}
	for _, m := range findMarkers(rs) {
		if m.n < 1 || m.n > len(sources) {
			hallucinated = append(hallucinated, m.n)
			continue
		}
		c := contract.Citation{Index: m.n, MarkerStart: u[m.start], MarkerEnd: u[m.end]}
		si := charToSent[m.start]
		sentText := string(rs[m.start:m.end])
		if si >= 0 {
			c.SentenceStart, c.SentenceEnd = u[sents[si].Start], u[sents[si].End]
			sentText = string(rs[sents[si].Start:sents[si].End])
		} else {
			c.SentenceStart, c.SentenceEnd = c.MarkerStart, c.MarkerEnd
		}
		if src, ok := byIndex[m.n]; ok && src.Passage != nil && *src.Passage != "" {
			c.Highlight = FindHighlight(sentText, *src.Passage, highlightThreshold)
		}
		cits = append(cits, c)
	}
	return cits, hallucinated
}

// ComputeConsensus counts cited sentences and those citing at least two
// distinct domains. nil when no sentence carries a valid citation: there is no
// placeholder score.
func ComputeConsensus(report string, cits []contract.Citation, sources []contract.SourceCard) *contract.Consensus {
	if len(textutil.SplitSentences(report)) == 0 {
		return nil
	}
	byIndex := map[int]string{}
	for _, s := range sources {
		if s.Index != nil {
			byIndex[*s.Index] = s.Domain
		}
	}
	perSentence := map[int]map[string]struct{}{}
	for _, c := range cits {
		d, ok := byIndex[c.Index]
		if !ok {
			continue
		}
		if perSentence[c.SentenceStart] == nil {
			perSentence[c.SentenceStart] = map[string]struct{}{}
		}
		perSentence[c.SentenceStart][d] = struct{}{}
	}
	cited := len(perSentence)
	if cited == 0 {
		return nil
	}
	supported := 0
	for _, ds := range perSentence {
		if len(ds) >= 2 {
			supported++
		}
	}
	score := round4(float64(supported) / float64(cited))
	return &contract.Consensus{Score: &score, SupportedSentences: supported, CitedSentences: cited}
}

// BalanceFences removes an unclosed openui-lang fence block (and everything
// after its opening line). changed reports whether anything was dropped.
func BalanceFences(text string) (out string, changed bool) {
	lines := strings.Split(text, "\n")
	result := make([]string, 0, len(lines))
	var fence []string
	in := false
	for _, line := range lines {
		if !in {
			if strings.HasPrefix(strings.TrimSpace(line), "```openui-lang") {
				in = true
				fence = []string{line}
			} else {
				result = append(result, line)
			}
			continue
		}
		fence = append(fence, line)
		if strings.TrimSpace(line) == "```" {
			result = append(result, fence...)
			in, fence = false, nil
		}
	}
	return strings.Join(result, "\n"), in
}
