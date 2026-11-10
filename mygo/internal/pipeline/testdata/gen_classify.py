"""Generate python_classify.json from the Python reference classifier.

Run (from mygo/):
  set PYTHONDONTWRITEBYTECODE=1
  set PYTHONPATH=..\backend
  python internal/pipeline/testdata/gen_classify.py

Expected values come from running the Python functions, never by hand.
"""
import json
import os
import sys

sys.dont_write_bytecode = True

from app.pipeline.classifier import _DOMAIN_RULES, classify_source, get_authority

domains = []
for d, _, _, _ in _DOMAIN_RULES:
    domains.append(d)
    domains.append("sub." + d)
domains += [
    "docs.example.com", "docs.rs", "docs.python.org", "foo.readthedocs.io",
    "notgithub.com", "github.com.evil.example", "evilarxiv.org", "blog.example.com",
    "medium.com", "zhihu.com", "youtube.com", "pytorch.org", "tridao.me",
    "export.arxiv.org", "raw.githubusercontent.com", "mirrors.w3.org", "",
]

out = []
for dom in domains:
    cat, rule = classify_source(dom)
    out.append({"domain": dom, "category": cat, "rule": rule, "authority": get_authority(dom)})

path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "python_classify.json")
with open(path, "w", encoding="utf-8", newline="\n") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
print("wrote", len(out), "cases ->", path)
