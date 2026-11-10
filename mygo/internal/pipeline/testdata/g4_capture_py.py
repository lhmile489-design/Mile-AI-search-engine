"""G4 task 2: capture the Python backend SSE stream for three questions.

Usage: python g4_capture_py.py <out_dir> [base_url]
Writes py_<name>.jsonl, one {"type","data"} object per frame, the same shape
as the Go capture (internal/service/live_g4_test.go).
"""
import json
import sys
import urllib.request

QUESTIONS = {
    "q1_benchmark": "FlashAttention-3 FP8 benchmark throughput on H100",
    "q2_chinese": "大模型推理中 KV Cache 量化方法对比",
    "q3_code": "torch.compile CUDA graphs reduce-overhead example code",
}


def main():
    out = sys.argv[1]
    base = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:8002"
    for name, q in QUESTIONS.items():
        body = json.dumps(
            {"query": q, "focusMode": "web", "engine": "tavily", "scopeFilters": []},
            ensure_ascii=False,
        ).encode("utf-8")
        req = urllib.request.Request(
            base + "/api/search/stream",
            data=body,
            headers={"Content-Type": "application/json; charset=utf-8"},
        )
        n = 0
        with urllib.request.urlopen(req, timeout=300) as resp, open(
            f"{out}/py_{name}.jsonl", "w", encoding="utf-8", newline="\n"
        ) as f:
            event = None
            for raw in resp:
                line = raw.decode("utf-8").rstrip("\n")
                if line.startswith("event: "):
                    event = line[7:]
                elif line.startswith("data: ") and event:
                    f.write(
                        json.dumps({"type": event, "data": json.loads(line[6:])}, ensure_ascii=False)
                        + "\n"
                    )
                    n += 1
                    event = None
        print(name, "frames", n)


if __name__ == "__main__":
    main()
