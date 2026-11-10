"""Generate python_parity.json from the Python reference implementation.

Run (from mygo/, read-only import of ../backend, no bytecode written there):
  set PYTHONDONTWRITEBYTECODE=1
  set PYTHONPATH=..\backend
  python internal/pipeline/testdata/gen_parity.py

The Go tests read the JSON; expected values are never computed by hand.
"""
import json
import os
import sys
from dataclasses import dataclass

sys.dont_write_bytecode = True

from app.pipeline.bibtex import generate_bibtex
from app.pipeline.finalizer import (
    _find_highlight,
    _parse_finalize_json,
    compute_consensus,
    parse_citations,
    split_sentences,
)
from app.pipeline.generator import _fix_unclosed_fences
from app.pipeline.providers import FullSource


def src(index, domain, passage=None):
    return FullSource(
        id=f"src_test{index:03d}",
        title=f"Test Source {index}",
        url=f"https://{domain}/page",
        domain=domain,
        favicon_url=None,
        engine="tavily",
        category="blog",
        category_source="rule",
        index=index,
        category_rule="default",
        passage=passage,
        passage_truncated=False if passage else None,
        scores=None,
        engine_signals=None,
        matched_queries=[0],
    )


SMILE = "\U0001F600"

CITATION_CASES = [
    {
        "name": "ascii",
        "report": "See result [1] here.",
        "sources": [(1, "github.com", "FlashAttention FP8 benchmark.")],
    },
    {
        "name": "cjk",
        "report": "研究结果显示 [1] 性能提升。",
        "sources": [(1, "arxiv.org", "相关研究表明性能提升。")],
    },
    {
        "name": "emoji_surrogate",
        "report": f"前{SMILE}句 [1]。后{SMILE}句 [2]。",
        "sources": [
            (1, "arxiv.org", f"前{SMILE}句性能提升很明显。其他内容。"),
            (2, "github.com", f"后{SMILE}句吞吐量更高。"),
        ],
    },
    {
        "name": "mixed_multi_marker_and_hallucination",
        "report": "FlashAttention-3 在 H100 上达到 1.3 PFLOPs/s [1][2]. Dao et al. 提出 FA3 [3]. 未知引用 [9].",
        "sources": [
            (1, "arxiv.org", "FlashAttention-3 reaches 1.3 PFLOPs/s on H100. Other text here."),
            (2, "github.com", "H100 吞吐量 1.3 PFLOPs/s 的测试。"),
            (3, "tridao.me", "Dao et al. proposed FA3 for Hopper."),
        ],
    },
    {
        "name": "decimals_versions",
        "report": "BF16 reaches 840.5 TFLOPs/s [1] and v1.0.2 is stable [2]. Next [1] [2].",
        "sources": [
            (1, "arxiv.org", "BF16 reaches 840.5 TFLOPs/s. Unrelated tail."),
            (2, "arxiv.org", "Version v1.0.2 is stable and released."),
        ],
    },
    {
        "name": "abbreviations",
        "report": "Use a technique, e.g. gradient checkpointing [1], to save memory. BF16 vs. FP8 is compared [2]. The cost is quadratic, i.e. O(n^2) [1].",
        "sources": [
            (1, "a.com", "gradient checkpointing saves memory."),
            (2, "b.com", "BF16 vs FP8 comparison table."),
        ],
    },
    {
        "name": "no_citations",
        "report": "No references here. Just text.",
        "sources": [(1, "github.com", None)],
    },
    {
        "name": "below_threshold",
        "report": "qqqq zzzz wwww [1].",
        "sources": [(1, "github.com", "Completely different content about FlashAttention.")],
    },
    {
        "name": "marker_at_text_start",
        "report": "[1] leading marker. Tail [2]",
        "sources": [(1, "a.com", "leading marker text."), (2, "b.com", "Tail text here.")],
    },
]


def run_citation_case(c):
    sources = [src(*s) for s in c["sources"]]
    cits, hall = parse_citations(c["report"], sources)
    cons = compute_consensus(c["report"], cits, sources)

    def u16slice(text, start, end):
        b = text.encode("utf-16-le")
        return b[start * 2:end * 2].decode("utf-16-le")

    passages = {i: p for (i, _d, p) in c["sources"]}
    hl_texts = []
    for ct in cits:
        h = ct["highlight"]
        if h is None:
            hl_texts.append(None)
        else:
            hl_texts.append(u16slice(passages[ct["index"]], h["start"], h["end"]))
    return {
        "name": c["name"],
        "highlightTexts": hl_texts,
        "report": c["report"],
        "sources": [
            {"index": i, "domain": d, "passage": p} for (i, d, p) in c["sources"]
        ],
        "citations": cits,
        "hallucinated": hall,
        "consensus": cons,
    }


@dataclass
class FakeSrc:
    category: str
    title: str
    url: str
    published_at: str | None = None


BIBTEX_CASES = [
    FakeSrc("preprint", "Attention Is All You Need", "https://arxiv.org/abs/1706.03762", "2017-06-12"),
    FakeSrc("preprint", "FlashAttention", "https://arxiv.org/pdf/2205.14135v2"),
    FakeSrc("preprint", "FlashAttention-3: Fast & Accurate 100% Attention_v2 #1 $x", "https://arxiv.org/html/2407.08608v1", "2024-07-11T00:00:00Z"),
    FakeSrc("preprint", "Old Style", "https://arxiv.org/abs/0704.0001"),
    FakeSrc("preprint", "A DOI Paper", "https://doi.org/10.1145/3503222.3507778", "2022-02-28"),
    FakeSrc("preprint", "DOI No Year", "https://doi.org/10.1145/3503222.3507778"),
    FakeSrc("preprint", "", "https://arxiv.org/abs/1706.03762", "2017-06-12"),
    FakeSrc("preprint", "No Id", "https://example.com/paper", "2020-01-01"),
    FakeSrc("blog", "Blog Post", "https://arxiv.org/abs/1706.03762", "2017-06-12"),
    FakeSrc("preprint", "OpenReview Only", "https://openreview.net/forum?id=tVConYid20", "2024-01-01"),
    FakeSrc("preprint", "Bad Year", "https://arxiv.org/abs/1706.03762", "1800-01-01"),
    FakeSrc("preprint", "  Padded Title  ", "https://arxiv.org/abs/2401.00001", "2024-01-02"),
]

FENCE_CASES = [
    "intro\n```openui-lang\nCard(a)\n```\noutro",
    "intro\n```openui-lang\nCard(a)\nmore",
    "intro\n```openui-lang\nCard(a)\n```\nmid\n```openui-lang\nTable(b)",
    "no fences at all\nsecond line",
    "  ```openui-lang\nindented open\n  ```  \nafter",
    "head\n```python\nprint(1)\n```\ntail",
    "",
    "tail fence ```openui-lang inline is not a fence line",
]

FINALIZE_JSON_CASES = [
    '{"takeaways":[{"text":"a","citations":[1]}],"followUps":["q1","q2","q3"]}',
    '```json\n{"takeaways":[{"text":"a","citations":[1]}],"followUps":["q"]}\n```',
    '好的，结果如下：\n{"takeaways":[],"followUps":["x"]}\n以上。',
    "not json at all",
    "",
    "{broken json",
    '```\n{"a":1}\n```',
]


def main():
    out = {
        "citations": [run_citation_case(c) for c in CITATION_CASES],
        "bibtex": [
            {
                "category": b.category,
                "title": b.title,
                "url": b.url,
                "publishedAt": b.published_at,
                "expected": generate_bibtex(b),
            }
            for b in BIBTEX_CASES
        ],
        "fences": [{"in": t, "out": _fix_unclosed_fences(t)} for t in FENCE_CASES],
        "finalizeJSON": [
            {"in": t, "out": _parse_finalize_json(t)} for t in FINALIZE_JSON_CASES
        ],
        "sentences": [
            {"in": t, "spans": split_sentences(t)}
            for t in [
                "We achieve 1.3 PFLOPs/s on H100.",
                "The library is at v1.0.2 and works well.",
                "BF16 reaches 840.5 TFLOPs/s and FP8 reaches 1.3 PFLOPs/s. Next sentence here.",
                "Use a technique, e.g. gradient checkpointing, to save memory. Done.",
                "The cost is quadratic, i.e. O(n^2). This is expensive.",
                "BF16 vs. FP8 throughput is compared below.",
                "Dao et al. proposed FlashAttention. It is efficient.",
                "Is it fast? Yes! Very fast.",
                f"前{SMILE}句。后{SMILE}句。",
                "第一句。第二句。第三句。",
                "wait... what?! really.",
                "",
            ]
        ],
    }
    dest = os.path.join(os.path.dirname(os.path.abspath(__file__)), "python_parity.json")
    with open(dest, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("wrote", dest)


main()
