// Package pipeline is the search main chain: rewrite, concurrent retrieval with
// fallback, rerank, streamed generation, and the orchestration that pushes
// StreamFrames to the page. Behavior follows backend/app/pipeline/*.py.
package pipeline

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/lhmile489-design/mile-ai-search/internal/provider"
)

// LLM is the chat-completions surface the pipeline needs. *provider.LLM
// implements it; tests substitute an httptest-backed client.
type LLM interface {
	Complete(ctx context.Context, system, user string, maxTokens int) (string, error)
	Stream(ctx context.Context, system, user string, maxTokens int, firstToken time.Duration, onToken func(string) error) (provider.StreamResult, error)
}

// RewriteFallbackCode is the §12 code attached to a degraded rewrite.
const RewriteFallbackCode = 50202

const rewriteSystemPrompt = `你是一个搜索查询优化助手。请将用户的技术问题改写为 3-5 个独立的英文搜索子查询，每个子查询专注于问题的不同侧面，便于从不同角度检索信息。

要求：
- 输出格式：JSON 数组，仅包含字符串列表，无其他内容
- 每个子查询不超过 80 字符（英文），简洁、精准
- 子查询之间不要重复，覆盖不同维度（性能、实现、对比、原理等）
- 不要包含中文，但可以保留技术名词原文
- 仅输出 JSON 数组，不要解释

示例输出：
["FlashAttention-3 FP8 kernel throughput benchmark","FlashAttention-3 Hopper FP8 TFLOPS","FA3 FP8 vs cuDNN attention performance"]`

var modeHints = map[string]string{
	"academic": "\n检索模式：学术/预印本，子查询应偏向 arXiv、论文关键词、实验对比、算法原理。",
	"code":     "\n检索模式：代码/仓库，子查询应偏向 GitHub、API 文档、实现示例、库版本。",
	"web":      "",
}

// RewriteUserPrompt builds the user message (rewriter.py: user_content).
func RewriteUserPrompt(query, focusMode string, scopeFilters []string) string {
	scopeHint := ""
	if len(scopeFilters) > 0 {
		allowed := map[string]bool{}
		for _, s := range scopeFilters {
			allowed[s] = true
		}
		var excluded []string
		for _, c := range provider.Categories {
			if !allowed[c] {
				excluded = append(excluded, c)
			}
		}
		if len(excluded) > 0 {
			scopeHint = "\n注意：不要生成含有以下类别站点关键词的查询词：" + strings.Join(excluded, ", ")
		}
	}
	return fmt.Sprintf("请将以下技术问题改写为 3-5 个搜索子查询：\n%s%s%s", query, modeHints[focusMode], scopeHint)
}

var jsonArrayRe = regexp.MustCompile(`(?s)\[.*?\]`)

// ParseQueries extracts a JSON string array from LLM output (rewriter.py:
// _parse_queries). Items are trimmed, blanks dropped, capped at 5. A parse
// failure yields nil; a valid but empty array yields an empty slice, exactly
// like the Python original (which does not retry the regex in that case).
func ParseQueries(text string) []string {
	text = strings.TrimSpace(text)
	if q, ok := parseStringArray(text); ok {
		return q
	}
	if m := jsonArrayRe.FindString(text); m != "" {
		if q, ok := parseStringArray(m); ok {
			return q
		}
	}
	return nil
}

func parseStringArray(s string) ([]string, bool) {
	var items []string
	if err := json.Unmarshal([]byte(s), &items); err != nil {
		return nil, false
	}
	out := make([]string, 0, len(items))
	for _, it := range items {
		if t := strings.TrimSpace(it); t != "" {
			out = append(out, t)
		}
	}
	if len(out) > 5 {
		out = out[:5]
	}
	return out, true
}

// Rewrite asks the LLM for 3-5 sub-queries. Any failure degrades to the
// original query with fallback=true and code 50202. The caller must check
// ctx.Err() afterwards: a canceled context also lands in the fallback path.
func Rewrite(ctx context.Context, llm LLM, timeout time.Duration, query, focusMode string, scopeFilters []string) (queries []string, fallback bool, code int) {
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	content, err := llm.Complete(cctx, rewriteSystemPrompt, RewriteUserPrompt(query, focusMode, scopeFilters), 500)
	if err != nil {
		return []string{query}, true, RewriteFallbackCode
	}
	q := ParseQueries(content)
	if len(q) == 0 {
		return []string{query}, true, RewriteFallbackCode
	}
	return q, false, 0
}
