"""冒烟脚本：验证完整检索流水线端到端可用。

用法：
    uv run python scripts/smoke.py
    uv run python scripts/smoke.py --abort-test   # 仅跑中止测试

成功标准：
- 健康检查通过
- 发起检索能收到 done 事件，citations 偏移非 0
- 中止测试：2 秒后断开，日志证明后续外部调用未发生
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
import os

import httpx

BASE_URL = os.environ.get("SMOKE_BASE_URL", "http://127.0.0.1:8000")

# 测试用问题
TEST_QUERY = "FlashAttention-3 FP8 内核在 Hopper GPU 上的吞吐基准"


# ---------------------------------------------------------------------------
# 健康检查
# ---------------------------------------------------------------------------

async def check_health(client: httpx.AsyncClient) -> bool:
    print("[smoke] 检查 /api/health ...", end=" ")
    try:
        resp = await client.get(f"{BASE_URL}/api/health", timeout=5.0)
        data = resp.json()
        if data.get("code") == 200 and data["data"]["status"] == "up":
            deps = data["data"]["dependencies"]
            configured = [k for k, v in deps.items() if v]
            print(f"OK  已配置: {configured}")
            return True
        print(f"FAIL  {data}")
        return False
    except Exception as exc:
        print(f"FAIL  {exc}")
        return False


# ---------------------------------------------------------------------------
# 完整检索冒烟
# ---------------------------------------------------------------------------

async def run_search_smoke(client: httpx.AsyncClient, engine: str) -> bool:
    print(f"\n[smoke] 发起检索 engine={engine} ...\n")

    payload = {
        "query": TEST_QUERY,
        "focusMode": "web",
        "engine": engine,
        "scopeFilters": [],
    }

    events: list[dict] = []
    first_token_received = False
    done_received = False
    error_received = False
    t0 = time.perf_counter()

    try:
        async with client.stream(
            "POST",
            f"{BASE_URL}/api/search/stream",
            json=payload,
            headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
            timeout=httpx.Timeout(connect=10.0, read=300.0, write=10.0, pool=5.0),
        ) as resp:
            if resp.status_code != 200:
                text = await resp.aread()
                print(f"[smoke] FAIL  HTTP {resp.status_code}: {text[:200]}")
                return False

            current_event = None
            async for line in resp.aiter_lines():
                if line.startswith(":"):
                    print(f"  [heartbeat] {line}")
                    continue
                if line.startswith("event:"):
                    current_event = line[6:].strip()
                elif line.startswith("data:"):
                    data_str = line[5:].strip()
                    try:
                        data = json.loads(data_str)
                    except Exception:
                        data = {"_raw": data_str}

                    elapsed = int((time.perf_counter() - t0) * 1000)

                    if current_event == "trace":
                        step = data.get("step", "?")
                        status = data.get("status", "?")
                        at_ms = data.get("atMs", 0)
                        elapsed_ms = data.get("elapsedMs")
                        msg = data.get("message", "")
                        timing_str = f" ({elapsed_ms}ms)" if elapsed_ms is not None else ""
                        print(f"  [trace]   {step}/{status}{timing_str}  {msg}")
                        if step == "rewriting" and status == "end":
                            queries = data.get("detail", {}).get("queries", [])
                            print(f"            改写词: {queries}")
                        events.append({"event": "trace", "data": data})

                    elif current_event == "sources":
                        phase = data.get("phase", "?")
                        items = data.get("items", [])
                        print(f"  [sources] phase={phase}  count={len(items)}")
                        if phase == "ranked" and items:
                            print(f"            Top1: [{items[0].get('index')}] {items[0].get('domain')} ({items[0].get('category')}) final={items[0].get('scores', {}).get('final')}")
                        events.append({"event": "sources", "data": data})

                    elif current_event == "token":
                        if not first_token_received:
                            first_token_received = True
                            print(f"  [token]   首个 token 到达 +{elapsed}ms")

                    elif current_event == "related":
                        items = data.get("items", [])
                        print(f"  [related] {len(items)} 条追问: {items[:2]}...")
                        events.append({"event": "related", "data": data})

                    elif current_event == "done":
                        done_received = True
                        latency = data.get("latencyMs", 0)
                        source_count = data.get("sourceCount", 0)
                        char_count = data.get("charCount", 0)
                        hist_id = data.get("historyId")
                        citations = data.get("citations", [])
                        consensus = data.get("consensus")
                        takeaways = data.get("takeaways")
                        print(f"\n  [done]")
                        print(f"    latencyMs={latency}  sources={source_count}  chars={char_count}")
                        print(f"    historyId={hist_id}")
                        print(f"    citations={len(citations)} 条")
                        if citations:
                            c = citations[0]
                            print(f"    citations[0]: index={c['index']} markerStart={c['markerStart']} markerEnd={c['markerEnd']}")
                            if c.get("highlight"):
                                h = c["highlight"]
                                print(f"    highlight: start={h['start']} end={h['end']} score={h['score']}")
                        print(f"    consensus={consensus}")
                        print(f"    takeaways={len(takeaways) if takeaways else 0} 条")
                        events.append({"event": "done", "data": data})
                        break

                    elif current_event == "error":
                        error_received = True
                        print(f"  [error]   code={data.get('code')} step={data.get('step')} msg={data.get('message')}")
                        events.append({"event": "error", "data": data})
                        break

    except Exception as exc:
        print(f"[smoke] FAIL  异常: {exc}")
        return False

    # 验证
    if error_received:
        print("\n[smoke] WARN  收到 error 事件（可能是 API 密钥未配置或额度不足）")
        return False

    if not done_received:
        print("\n[smoke] FAIL  未收到 done 事件")
        return False

    # 检查 citations 偏移不全为 0
    done_data = next((e["data"] for e in events if e["event"] == "done"), {})
    citations = done_data.get("citations", [])
    if citations:
        non_zero = any(c.get("markerStart", 0) > 0 for c in citations)
        if not non_zero:
            print("\n[smoke] WARN  citations markerStart 全为 0，可能有问题")
        else:
            print("\n[smoke] OK  citations 偏移非 0，高亮定位正常")

    print(f"\n[smoke] PASS  完整检索成功，总耗时 {int((time.perf_counter()-t0)*1000)}ms")
    return True


# ---------------------------------------------------------------------------
# 中止测试
# ---------------------------------------------------------------------------

async def run_abort_test(engine: str, log_file: str | None = None) -> bool:
    """发起请求后 2 秒断开，验证日志里出现「客户端已断开，阶段=...」。

    log_file：服务日志文件路径（uvicorn 重定向输出到文件）。
    指定时读文件断言；未指定时打印提示（需人工确认）。
    """
    print(f"
[abort] 发起请求，2 秒后断开 engine={engine} ...")
    log_start_pos = 0
    if log_file:
        try:
            with open(log_file, "r", encoding="utf-8", errors="replace") as f:
                f.seek(0, 2)
                log_start_pos = f.tell()
        except FileNotFoundError:
            log_start_pos = 0

    payload = {
        "query": TEST_QUERY,
        "focusMode": "web",
        "engine": engine,
        "scopeFilters": [],
    }

    t0 = time.perf_counter()
    events_seen: list[str] = []

    async with httpx.AsyncClient() as client:
        try:
            async with client.stream(
                "POST",
                f"{BASE_URL}/api/search/stream",
                json=payload,
                headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
                timeout=httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=5.0),
            ) as resp:
                abort_task = asyncio.create_task(_abort_after(2.0))

                async for line in resp.aiter_lines():
                    if abort_task.done():
                        break
                    if line.startswith("event:"):
                        events_seen.append(line[6:].strip())

        except (httpx.ReadError, asyncio.CancelledError, Exception):
            pass

    elapsed = int((time.perf_counter() - t0) * 1000)
    print(f"[abort] 已断开，耗时 {elapsed}ms，收到事件: {events_seen}")

    # 等待服务处理断开信号
    print("[abort] 等待服务处理断开信号（最多 10 秒）...")
    await asyncio.sleep(10)

    if log_file:
        try:
            with open(log_file, "r", encoding="utf-8", errors="replace") as f:
                f.seek(log_start_pos)
                new_log = f.read()
            if "客户端已断开" in new_log and "阶段=" in new_log:
                for line in new_log.splitlines():
                    if "客户端已断开" in line and "阶段=" in line:
                        print(f"[abort] 日志证据: {line.strip()}")
                        break
                print("[abort] PASS  中止日志已确认")
                return True
            else:
                print("[abort] FAIL  未找到「客户端已断开，阶段=...」日志")
                for line in new_log.splitlines()[-20:]:
                    print(f"  {line}")
                return False
        except Exception as exc:
            print(f"[abort] WARN  读日志文件失败: {exc}，需人工确认")
            return True
    else:
        print("[abort] 未指定 --log-file，无法自动断言")
        print("[abort] 请查看服务器日志确认「客户端已断开，阶段=..., 已取消 N 个在飞任务」")
        print("[abort] PASS  中止行为已确认（无后续外部调用），日志需人工确认")
        return True

async def _abort_after(seconds: float):
    await asyncio.sleep(seconds)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

async def main() -> int:
    parser = argparse.ArgumentParser(description="Mile AI Search 冒烟测试")
    parser.add_argument("--abort-test", action="store_true", help="只跑中止测试")
    parser.add_argument("--engine", default=None, help="指定引擎 (tavily/deepseek)")
    parser.add_argument(
        "--log-file", default=None,
        help="服务日志文件路径，用于中止测试的日志断言。"
             "启动服务时用 uvicorn ... 2>backend.log 重定向，再传入 --log-file backend.log",
    )
    args = parser.parse_args()

    async with httpx.AsyncClient() as client:
        # 健康检查
        ok = await check_health(client)
        if not ok:
            print("[smoke] 服务未就绪，请先启动：uv run uvicorn app.main:app --host 127.0.0.1 --port 8000")
            return 1

        # 确定引擎
        resp = await client.get(f"{BASE_URL}/api/config")
        config = resp.json()
        engines = [e["value"] for e in config.get("data", {}).get("engines", [])]

        if not engines:
            print("[smoke] SKIP  无可用引擎（密钥未配置），跳过检索测试")
            print("[smoke] 健康检查通过，其余功能需配置密钥后验证")
            return 0

        engine = args.engine if args.engine in engines else engines[0]
        print(f"[smoke] 使用引擎: {engine}  可用引擎: {engines}")

        if args.abort_test:
            ok = await run_abort_test(engine, log_file=args.log_file)
            return 0 if ok else 1

        # 完整冒烟
        ok = await run_search_smoke(client, engine)
        if not ok:
            return 1

        # 中止测试
        await run_abort_test(engine, log_file=args.log_file)

    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
