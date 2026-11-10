"""G4 task 2: structural invariants over captured SSE frames.

Usage: python g4_check.py <dir>
Reads go_<q>.jsonl and py_<q>.jsonl (one {"type","data"} per line), prints one
block per file, and the Top 10 URL overlap per question (informational only).

Consensus is recomputed from the contract definition, independent of both
sentence splitters: group done.citations by sentenceStart, collect the domains
of the cited sources (looked up by index in the ranked sources), count the
sentences that cite >= 2 distinct domains.
"""
import json
import os
import sys

NAMES = ["q1_benchmark", "q2_chinese", "q3_code"]
DONE_FIELDS = [
    "historyId", "latencyMs", "stageTimings", "firstTokenMs", "tokenStats",
    "citations", "takeaways", "consensus", "engine", "enginesUsed", "degraded",
    "sourceCount", "charCount", "cacheHit",
]
TIMING_KEYS = ["rewritingMs", "searchingMs", "reasoningMs", "generatingMs"]
STAGE_ORDER = ["rewriting", "searching", "reasoning", "generating"]


def load(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def u16(text):
    return text.encode("utf-16-le")


def u16slice(text, start, end):
    b = u16(text)
    return b[start * 2:end * 2].decode("utf-16-le", errors="replace")


def recompute_consensus(citations, ranked):
    dom = {s["index"]: s["domain"] for s in ranked if s.get("index") is not None}
    per = {}
    for c in citations:
        d = dom.get(c["index"])
        if d is None:
            continue
        per.setdefault(c["sentenceStart"], set()).add(d)
    cited = len(per)
    if cited == 0:
        return None
    sup = sum(1 for ds in per.values() if len(ds) >= 2)
    return {"score": round(sup / cited, 4), "supportedSentences": sup, "citedSentences": cited}


def check(path):
    frames = load(path)
    res = []

    def ok(name, cond, detail=""):
        res.append((name, bool(cond), detail))

    types = [f["type"] for f in frames]
    compact = [t for i, t in enumerate(types) if i == 0 or types[i - 1] != t]
    ok("no error frame", "error" not in types, f"types={compact}")
    ok("last frame is done", types[-1:] == ["done"])
    ok("done exactly once", types.count("done") == 1)

    # order: sources(ranked) before the first token, related before done
    ranked_frames = [f for f in frames if f["type"] == "sources" and f["data"].get("phase") == "ranked"]
    first_tok = types.index("token") if "token" in types else -1
    first_ranked = next((i for i, f in enumerate(frames) if f["type"] == "sources" and f["data"].get("phase") == "ranked"), -1)
    ok("ranked sources precede first token", first_ranked != -1 and first_tok != -1 and first_ranked < first_tok)
    if "related" in types and "done" in types:
        ok("related precedes done", types.index("related") < types.index("done"))
    starts = [f["data"]["step"] for f in frames if f["type"] == "trace" and f["data"]["status"] == "start"]
    ok("stage start order", starts[:4] == STAGE_ORDER, f"starts={starts}")

    report = "".join(f["data"]["delta"] for f in frames if f["type"] == "token")
    done = next((f["data"] for f in frames if f["type"] == "done"), None)
    if done is None:
        ok("done present", False)
        return res, [], None
    ok("done fields complete", all(k in done for k in DONE_FIELDS),
       "missing=" + str([k for k in DONE_FIELDS if k not in done]))

    # Python wire format: "items"; Go binding payload: "ranked" (transport.ts maps it to "items").
    last = ranked_frames[-1]["data"] if ranked_frames else {}
    ranked = last.get("ranked") or last.get("items") or []

    # markerStart slices
    bad = []
    for c in done["citations"]:
        got = u16slice(report, c["markerStart"], c["markerEnd"])
        if got != f"[{c['index']}]":
            bad.append((c["index"], c["markerStart"], got))
    ok("citation marker slices equal [n]", not bad, f"n={len(done['citations'])} bad={bad[:3]}")

    fence_lines = [ln for ln in report.split("\n") if ln.strip().startswith("```")]
    ok("fence open/close balanced", len(fence_lines) % 2 == 0, f"fence_lines={len(fence_lines)}")

    mine = recompute_consensus(done["citations"], ranked)
    ok("consensus recomputes equal", mine == done["consensus"], f"recomputed={mine} done={done['consensus']}")

    bib_bad = [s["url"] for s in ranked if s.get("bibtex") and s.get("category") != "preprint"]
    preprint = [s for s in ranked if s.get("category") == "preprint"]
    ok("bibtex only on preprint", not bib_bad, f"preprint={len(preprint)} withBibtex={sum(1 for s in preprint if s.get('bibtex'))}")

    st = done["stageTimings"] or {}
    ok("stageTimings four items measured",
       all(isinstance(st.get(k), int) and st.get(k) >= 0 for k in TIMING_KEYS) and (st.get("generatingMs") or 0) > 0,
       f"{st}")
    ok("cacheHit false on fresh run", done["cacheHit"] is False)
    return res, [s["url"] for s in ranked[:10]], {"consensus": done["consensus"], "recomputed": mine}


def main():
    d = sys.argv[1]
    for q in NAMES:
        tops = {}
        for side in ("go", "py"):
            p = os.path.join(d, f"{side}_{q}.jsonl")
            if not os.path.exists(p):
                print(f"[{side}] {q}: missing {p}")
                continue
            res, top, cons = check(p)
            tops[side] = top
            print(f"== {side} {q}")
            for name, passed, detail in res:
                print(f"  {'PASS' if passed else 'FAIL'}  {name}  {detail}")
            if cons:
                print(f"  consensus done={cons['consensus']} recomputed={cons['recomputed']}")
        if len(tops) == 2:
            print(f"-- {q} top10 overlap = {len(set(tops['go']) & set(tops['py']))} (informational)")


if __name__ == "__main__":
    main()
