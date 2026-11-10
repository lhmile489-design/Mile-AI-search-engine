package provider

import (
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// usesNetloc mirrors Python urllib.parse.uses_netloc (urlunparse adds "//").
var usesNetloc = map[string]bool{
	"": true, "ftp": true, "http": true, "https": true, "file": true,
	"ws": true, "wss": true, "sftp": true, "git": true, "svn": true,
}

// NormalizeURL implements docs/接口设计.md §4.2 the way the Python reference
// does: lowercase scheme/host, drop www., drop default ports, trim a trailing
// slash, drop utm_ params, drop the fragment.
func NormalizeURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	scheme := strings.ToLower(u.Scheme)
	hostport := strings.ToLower(u.Host)

	hostname, portStr := hostport, ""
	if i := strings.LastIndex(hostport, ":"); i >= 0 && !strings.HasSuffix(hostport, "]") {
		hostname, portStr = hostport[:i], hostport[i+1:]
	}
	port := -1
	if n, err := strconv.Atoi(portStr); err == nil {
		port = n
	}
	hostname = strings.TrimPrefix(hostname, "www.")

	netloc := hostname
	switch {
	case scheme == "http" && port == 80, scheme == "https" && port == 443:
	case port > 0:
		netloc = hostname + ":" + strconv.Itoa(port)
	}

	path := u.EscapedPath()
	if path == "" {
		path = "/"
	}
	if len(path) > 1 && strings.HasSuffix(path, "/") {
		path = strings.TrimRight(path, "/")
	}

	res := path
	if netloc != "" || (usesNetloc[scheme] && !strings.HasPrefix(res, "//")) {
		if res != "" && res[0] != '/' {
			res = "/" + res
		}
		res = "//" + netloc + res
	}
	if scheme != "" {
		res = scheme + ":" + res
	}
	if q := normalizeQuery(u.RawQuery); q != "" {
		res += "?" + q
	}
	return res
}

// normalizeQuery drops utm_* keys and re-encodes the rest in first-seen key
// order (parse_qs keep_blank_values + urlencode doseq).
func normalizeQuery(rawQuery string) string {
	if rawQuery == "" {
		return ""
	}
	var keys []string
	vals := map[string][]string{}
	for _, field := range strings.Split(rawQuery, "&") {
		if field == "" {
			continue
		}
		k, v, _ := strings.Cut(field, "=")
		k, v = unquotePlus(k), unquotePlus(v)
		if strings.HasPrefix(k, "utm_") {
			continue
		}
		if _, ok := vals[k]; !ok {
			keys = append(keys, k)
		}
		vals[k] = append(vals[k], v)
	}
	var parts []string
	for _, k := range keys {
		for _, v := range vals[k] {
			parts = append(parts, url.QueryEscape(k)+"="+url.QueryEscape(v))
		}
	}
	return strings.Join(parts, "&")
}

func unquotePlus(s string) string {
	if out, err := url.QueryUnescape(s); err == nil {
		return out
	}
	return s
}

// StableID is "src_" + sha256(normalized URL)[:12] (§4.2).
func StableID(raw string) string {
	sum := sha256.Sum256([]byte(NormalizeURL(raw)))
	return "src_" + hex.EncodeToString(sum[:])[:12]
}

// DisplayURL strips only the # fragment.
func DisplayURL(raw string) string {
	if i := strings.Index(raw, "#"); i >= 0 {
		return raw[:i]
	}
	return raw
}

// ExtractDomain is the lowercase host without port and without www. (§4.1).
func ExtractDomain(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	host := strings.ToLower(u.Host)
	if i := strings.LastIndex(host, ":"); i >= 0 && !strings.HasSuffix(host, "]") {
		host = host[:i]
	}
	return strings.TrimPrefix(host, "www.")
}

// ---- passage cleaning (§4.4) ----

var (
	navLineRE     = regexp.MustCompile(`(?m)^\s*\[(?:Skip to content|Back to [^\]]+)\]\([^)]+\)\s*$`)
	singleLinkRE  = regexp.MustCompile(`(?m)^\s*\[[^\]]+\]\([^)]+\)\s*$`)
	mdImageRE     = regexp.MustCompile(`!\[[^\]]*\]\([^)]*\)`)
	mdLinkRE      = regexp.MustCompile(`\[([^\]]+)\]\([^)]+\)`)
	multiNewlineR = regexp.MustCompile(`\n{3,}`)
)

const (
	maxPassageChars   = 1500
	truncSearchWindow = 200
)

// CleanPassage returns (cleaned, truncated). An empty result means "no passage".
// The length cap counts code points.
func CleanPassage(text string) (string, bool) {
	if text == "" {
		return "", false
	}
	if strings.HasPrefix(text, "2000 character limit reached") {
		if nl := strings.Index(text, "\n"); nl >= 0 {
			text = text[nl+1:]
		} else {
			text = ""
		}
	}
	text = navLineRE.ReplaceAllString(text, "")
	text = singleLinkRE.ReplaceAllString(text, "")
	text = mdImageRE.ReplaceAllString(text, "")
	text = mdLinkRE.ReplaceAllString(text, "$1")
	text = multiNewlineR.ReplaceAllString(text, "\n\n")
	text = strings.TrimSpace(text)
	if text == "" {
		return "", false
	}

	runes := []rune(text)
	if len(runes) <= maxPassageChars {
		return text, false
	}
	best := maxPassageChars
	for i := maxPassageChars - 1; i >= maxPassageChars-truncSearchWindow; i-- {
		if strings.ContainsRune(".!?。！？\n", runes[i]) {
			best = i + 1
			break
		}
	}
	return strings.TrimRight(string(runes[:best]), " \t\r\n\v\f"), true
}
