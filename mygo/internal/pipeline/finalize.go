package pipeline

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/lhmile489-design/mile-ai-search/internal/contract"
)

const finalizeSystem = `你是一个技术研报分析助手。请基于研报内容，完成以下任务，以 JSON 格式输出。

输出格式：
{
  "takeaways": [
    {"text": "核心要点1（≤60字）", "citations": [1, 2]},
    ...
  ],
  "followUps": ["追问1", "追问2", "追问3"]
}

要求：
- takeaways：3-5条，每条附上来自研报的引用编号（整数数组）
- followUps：3-5条追问，每条≤100字，无引用编号
- 不用 emoji，只输出 JSON`

var (
	fenceJSONRe = regexp.MustCompile("(?s)```(?:json)?\\s*(\\{.*?\\})\\s*```")
	braceRe     = regexp.MustCompile(`(?s)\{.*\}`)
)

// ParseFinalizeJSON tolerates a bare object, a fenced block, or an object
// surrounded by prose. nil means nothing parseable.
func ParseFinalizeJSON(text string) map[string]json.RawMessage {
	text = strings.TrimSpace(text)
	try := func(s string) map[string]json.RawMessage {
		var m map[string]json.RawMessage
		if json.Unmarshal([]byte(s), &m) != nil || m == nil {
			return nil
		}
		return m
	}
	if m := try(text); m != nil {
		return m
	}
	if g := fenceJSONRe.FindStringSubmatch(text); g != nil {
		if m := try(g[1]); m != nil {
			return m
		}
	}
	if s := braceRe.FindString(text); s != "" {
		return try(s)
	}
	return nil
}

// Finalized is the structured output of the closing LLM call. A nil field
// means that part failed; nothing is invented to fill it.
type Finalized struct {
	Takeaways []contract.Takeaway
	FollowUps []string
}

// Finalize makes one non-streaming call. reason is "" on success, otherwise a
// short degrade explanation for the trace.
func Finalize(ctx context.Context, llm LLM, timeout time.Duration, report string) (res Finalized, reason string) {
	rs := []rune(report)
	snippet := report
	if len(rs) > 3000 {
		snippet = string(rs[:3000]) + "..."
	}
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	content, err := llm.Complete(cctx, finalizeSystem, "研报内容：\n"+snippet, 1000)
	if err != nil {
		if errors.Is(cctx.Err(), context.DeadlineExceeded) {
			return res, "收尾调用超时"
		}
		return res, "收尾调用失败"
	}
	parsed := ParseFinalizeJSON(strings.TrimSpace(content))
	if parsed == nil {
		return res, "收尾结果无法解析为 JSON"
	}
	var tk []contract.Takeaway
	if raw, ok := parsed["takeaways"]; ok && json.Unmarshal(raw, &tk) == nil && len(tk) >= 3 {
		if len(tk) > 5 {
			tk = tk[:5]
		}
		for i := range tk {
			if tk[i].Citations == nil {
				tk[i].Citations = []int{}
			}
		}
		res.Takeaways = tk
	}
	var fu []string
	if raw, ok := parsed["followUps"]; ok && json.Unmarshal(raw, &fu) == nil && len(fu) >= 3 {
		if len(fu) > 5 {
			fu = fu[:5]
		}
		res.FollowUps = fu
	}
	if res.Takeaways == nil && res.FollowUps == nil {
		return res, "收尾结果条数不足"
	}
	return res, ""
}
