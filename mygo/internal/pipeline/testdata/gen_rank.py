"""Generate python_rank.json: run the Python rank_sources on the captured raw input.

Run (from mygo/):
  set PYTHONDONTWRITEBYTECODE=1
  set PYTHONPATH=..\backend
  python internal/pipeline/testdata/gen_rank.py

Input : rank_input.json (raw provider results captured from one real search)
Output: python_rank.json (expected order and scores; never computed by hand)
"""
import json
import os
import sys
from datetime import datetime, timezone

sys.dont_write_bytecode = True

import app.pipeline.ranker as ranker
from app.pipeline.providers import RawSource

# Freeze "now" so freshness is reproducible; the Go test uses the same instant.
NOW = datetime(2026, 11, 10, 0, 0, 0, tzinfo=timezone.utc)


class _FrozenDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return NOW if tz else NOW.replace(tzinfo=None)


ranker.datetime = _FrozenDatetime

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "rank_input.json"), encoding="utf-8") as f:
    items = json.load(f)


def to_raw(d):
    r = RawSource(
        id=d["ID"], title=d["Title"], url=d["URL"], domain=d["Domain"],
        favicon_url=d.get("FaviconURL"), engine=d["Engine"], category=d["Category"],
        category_source=d.get("CategorySource") or "rule",
        published_at=d.get("PublishedAt"),
    )
    r._raw_score = d.get("RawScore")
    r._rerank_score = d.get("RerankScore")
    r._authority_signal = d.get("AuthoritySignal")
    r._matched_queries = list(d.get("MatchedQueries") or [])
    r._summary = d.get("Summary") or None
    r._content = d.get("Content") or None
    return r


cases = []
for focus, scope in [("web", []), ("academic", []), ("code", []), ("web", ["preprint", "code"])]:
    ranked = ranker.rank_sources([to_raw(d) for d in items], focus, scope, top_k=30)
    cases.append({
        "focusMode": focus,
        "scope": scope,
        "now": NOW.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ranked": [
            {
                "index": s.index,
                "url": s.url,
                "category": s.category,
                "relevance": s.scores["relevance"],
                "authority": s.scores["authority"],
                "freshness": s.scores["freshness"],
                "final": s.scores["final"],
                "matchedQueries": sorted(s.matched_queries),
            }
            for s in ranked
        ],
    })

with open(os.path.join(here, "python_rank.json"), "w", encoding="utf-8", newline="\n") as f:
    json.dump(cases, f, ensure_ascii=False, indent=1)
print("wrote", len(cases), "cases;", [len(c["ranked"]) for c in cases], "ranked each")
