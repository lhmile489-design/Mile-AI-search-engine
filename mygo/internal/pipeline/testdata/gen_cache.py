"""Generate python_cache_keys.json from the Python reference (_make_l1_key / _make_l2_key).

Run (from mygo/):
  set PYTHONDONTWRITEBYTECODE=1
  uv run --project ..\backend python internal/pipeline/testdata/gen_cache.py
"""
import json
import os
import sys
import unicodedata

sys.dont_write_bytecode = True

from app.pipeline._cache import _make_l1_key, _make_l2_key

# "e" + combining acute (NFD) vs precomposed e-acute (NFC) must give the same L2 key.
NFD = "caf" + "é"
NFC = unicodedata.normalize("NFC", NFD)

L2 = [
    ("FlashAttention-3 FP8", "web", "tavily", []),
    ("  FlashAttention-3 FP8  ", "web", "tavily", []),
    ("FLASHATTENTION-3 fp8", "web", "tavily", []),
    ("FlashAttention-3 FP8", "academic", "tavily", []),
    ("FlashAttention-3 FP8", "web", "deepseek", []),
    ("FlashAttention-3 FP8", "web", "tavily", ["code", "preprint"]),
    ("FlashAttention-3 FP8", "web", "tavily", ["preprint", "code"]),
    ("大语言模型量化方法 GPTQ", "code", "tavily", ["docs"]),
    (NFD, "web", "tavily", []),
    (NFC, "web", "tavily", []),
]
L1 = [
    ("tavily", [], "flash attention 3 benchmark"),
    ("tavily", [], "  flash attention 3 benchmark  "),
    ("deepseek", [], "flash attention 3 benchmark"),
    ("tavily", ["code", "blog"], "Hopper 张量核心"),
    ("tavily", ["blog", "code"], "Hopper 张量核心"),
]

out = {
    "l2": [{"query": q, "focusMode": f, "engine": e, "scope": s, "key": _make_l2_key(q, f, e, s)} for q, f, e, s in L2],
    "l1": [{"engine": e, "scope": s, "subQuery": q, "key": _make_l1_key(e, s, q)} for e, s, q in L1],
}
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "python_cache_keys.json")
with open(path, "w", encoding="utf-8", newline="\n") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
print("wrote", path, len(out["l2"]), len(out["l1"]))
