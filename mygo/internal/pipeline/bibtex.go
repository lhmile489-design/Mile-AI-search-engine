package pipeline

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var (
	arxivIDRe = regexp.MustCompile(`(?i)arxiv\.org/(?:abs|pdf|html|e-print)/([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)`)
	doiRe     = regexp.MustCompile(`(?i)(?:doi\.org/|/doi/)([^?#\s]+)`)
	yearRe    = regexp.MustCompile(`^(\d{4})`)
	verSufRe  = regexp.MustCompile(`v\d+$`)
	letterRe  = regexp.MustCompile(`[a-zA-Z]+`)
	bibEscape = strings.NewReplacer("&", `\&`, "%", `\%`, "_", `\_`, "#", `\#`, "$", `\$`)
)

func bibYear(publishedAt, arxivID string) string {
	if p := strings.TrimSpace(publishedAt); p != "" {
		if m := yearRe.FindStringSubmatch(p); m != nil {
			if y, _ := strconv.Atoi(m[1]); y >= 1900 && y <= 2100 {
				return m[1]
			}
		}
	}
	if len(arxivID) >= 4 {
		if yy, err := strconv.Atoi(arxivID[:4]); err == nil && yearRe.MatchString(arxivID[:4]) {
			_ = yy
			y := 2000 + yy/100
			if y >= 2007 && y <= 2100 {
				return strconv.Itoa(y)
			}
		}
	}
	return ""
}

// GenerateBibtex builds an entry for a preprint. It returns "" (not an
// invented entry) when title, year, or an arXiv id / DOI is missing.
func GenerateBibtex(category, title, url, publishedAt string) string {
	if category != "preprint" {
		return ""
	}
	title = strings.TrimSpace(title)
	if title == "" {
		return ""
	}
	var arxivID, doi string
	if m := arxivIDRe.FindStringSubmatch(url); m != nil {
		arxivID = m[1]
	} else if m := doiRe.FindStringSubmatch(url); m != nil {
		doi = m[1]
	}
	year := bibYear(publishedAt, arxivID)
	if year == "" || (arxivID == "" && doi == "") {
		return ""
	}
	var key string
	if arxivID != "" {
		key = "arxiv_" + strings.ReplaceAll(verSufRe.ReplaceAllString(arxivID, ""), ".", "_")
	} else {
		first := "paper"
		if w := letterRe.FindString(title); w != "" {
			first = strings.ToLower(w)
		}
		key = year + "_" + first
	}
	esc := bibEscape.Replace(title)
	if arxivID != "" {
		return fmt.Sprintf("@misc{%s,\n  title = {{%s}},\n  year = {%s},\n  eprint = {%s},\n  archivePrefix = {arXiv}\n}", key, esc, year, arxivID)
	}
	return fmt.Sprintf("@article{%s,\n  title = {{%s}},\n  year = {%s},\n  doi = {%s}\n}", key, esc, year, doi)
}
