package pipeline

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/lhmile489-design/mile-ai-search/internal/contract"
)

// generateSystemTemplate is generator.py's system prompt. The Python source
// doubles the braces for str.format; here they are already single.
const generateSystemTemplate = "你是一个专业的 AI 技术研报撰写助手。请基于提供的信源资料，为以下技术问题撰写一篇专业的研报。\n\n" +
	"要求：\n" +
	"- 使用 Markdown 格式，结构清晰（标题、段落、列表、代码块等）\n" +
	"- 每个关键断言后用 [n] 标注对应信源编号（n 为数字，与信源列表对应）\n" +
	"- 内容准确，只写信源中有支撑的内容\n" +
	"- 中英文技术名词保持原文\n" +
	"- 不使用 emoji\n" +
	"- 研报长度适中，覆盖问题核心\n\n" +
	"如果信源中有评测数据，请使用 openui-lang 代码块展示，格式如下：\n" +
	"```openui-lang\n" +
	"root = Table(\"表格标题\", [c1, c2, c3], [r1, r2])\n" +
	"c1 = Column(\"方法\", \"方法名称\", false)\n" +
	"c2 = Column(\"指标\", \"数值\", true)\n" +
	"r1 = Row({\"方法\": \"方案A\", \"指标\": \"100\"})\n" +
	"```\n\n" +
	"信源列表：\n" +
	"{sources_text}"

const maxSourcePassageRunes = 1200

// SourcesText renders the numbered source list (generator.py
// _build_sources_text): at most 1200 code points of passage per source.
func SourcesText(sources []contract.SourceCard) string {
	parts := make([]string, 0, len(sources))
	for _, s := range sources {
		passage := ""
		if s.Passage != nil {
			passage = *s.Passage
		}
		if r := []rune(passage); len(r) > maxSourcePassageRunes {
			passage = string(r[:maxSourcePassageRunes])
		}
		idx := 0
		if s.Index != nil {
			idx = *s.Index
		}
		parts = append(parts, fmt.Sprintf("[%d] %s\nURL: %s\n摘要: %s", idx, s.Title, s.URL, passage))
	}
	return strings.Join(parts, "\n\n")
}

// SystemPrompt fills the template with the source list.
func SystemPrompt(sources []contract.SourceCard) string {
	return strings.Replace(generateSystemTemplate, "{sources_text}", SourcesText(sources), 1)
}

// GenerateResult is what the stream returns beyond the pushed tokens.
type GenerateResult struct {
	Chars        int
	FirstTokenMs int64 // -1 when no token arrived
	Usage        *contract.TokenStats
}

// Generate streams the report. Every non-empty delta goes to onToken verbatim.
// ErrTimeout (no first token in time) and upstream errors are returned as is;
// the caller turns them into a 50202 error frame.
func Generate(ctx context.Context, llm LLM, firstToken time.Duration, query string, sources []contract.SourceCard, onToken func(string) error) (GenerateResult, error) {
	res := GenerateResult{FirstTokenMs: -1}
	chars := 0
	sr, err := llm.Stream(ctx, SystemPrompt(sources), query, 4096, firstToken, func(d string) error {
		chars += len([]rune(d))
		return onToken(d)
	})
	res.Chars = chars
	res.FirstTokenMs = sr.FirstTokenMs
	if sr.Usage != nil {
		res.Usage = &contract.TokenStats{
			PromptTokens:     sr.Usage.PromptTokens,
			CompletionTokens: sr.Usage.CompletionTokens,
			TotalTokens:      sr.Usage.TotalTokens,
			CachedTokens:     sr.Usage.CachedTokens,
			Calls:            1,
		}
	}
	return res, err
}
