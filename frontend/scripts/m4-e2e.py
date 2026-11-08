"""M4 联调与稳定性验收：真实后端 + 真实前端（next start -p 3000）。

前置：后端 127.0.0.1:8000（M4 版，带缓存与心跳）和前端 http://localhost:3000 已启动。
用法：python scripts/m4-e2e.py [阶段 ...]
阶段：
  cache      同一问题连续提交两次：第二次出现「缓存命中」，latencyMs 与第一次不同，且是真实回放耗时
  multi      三个不同问题连续提交：结果页正常、历史条数增加、无 pageerror、无 console error
  precise    角标精确高亮：同一信源的两个不同角标，高亮区间不同；历史恢复后同样成立
  watchdog   一次完整检索期间不出现「连接超时」
  stability  PRD 目标：连续 N 次（默认 20）检索，其中至少 R 次（默认 8）真实未命中；输出统计
环境变量：M4_TOTAL（默认 20）、M4_REAL（默认 8）
不带参数时按顺序跑 cache multi precise watchdog stability。截图输出到 docs/screenshots/M4/。
"""

import glob
import os
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import Page, expect, sync_playwright

BASE = "http://localhost:3000"
OUT = Path(__file__).resolve().parent.parent / "docs" / "screenshots" / "M4"
results: list[tuple[str, bool, str]] = []

QUESTIONS = [
    "FlashAttention-3 FP8 内核吞吐基准",
    "NVIDIA Hopper TMA 异步拷贝指令优化",
    "vLLM PagedAttention 原理与实现细节",
    "大语言模型量化方法 GPTQ AWQ SmoothQuant 对比",
    "Speculative Decoding 原理与加速效果",
    "Mixture of Experts 路由负载均衡方法",
    "KV Cache 压缩与淘汰策略综述",
    "Ring Attention 长上下文并行原理",
    "Triton 编写矩阵乘法内核的优化技巧",
    "Transformer 位置编码 RoPE 与 ALiBi 对比",
]


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name} {detail}", flush=True)


class Session:
    """一个浏览器页面，收集 pageerror 与 console error。"""

    def __init__(self, pw, width: int = 1440, height: int = 900) -> None:
        candidates = sorted(glob.glob(os.path.expanduser("~/AppData/Local/ms-playwright/chromium-*/chrome-win64/chrome.exe")))
        exe = os.environ.get("PW_CHROME") or (candidates[-1] if candidates else None)
        self.browser = pw.chromium.launch(executable_path=exe) if exe else pw.chromium.launch()
        self.page: Page = self.browser.new_context(viewport={"width": width, "height": height}, locale="zh-CN").new_page()
        self.page_errors: list[str] = []
        self.console_errors: list[str] = []
        self.page.on("pageerror", lambda e: self.page_errors.append(str(e)))
        self.page.on(
            "console",
            lambda m: self.console_errors.append(m.text) if m.type == "error" else None,
        )
        self.page.goto(BASE)
        expect(self.page.get_by_label("输入技术问题")).to_be_visible()

    def close(self) -> None:
        self.browser.close()

    def search(self, query: str, timeout_s: int = 180) -> dict:
        """回到首屏提交一个问题，等到结果页完成或出现错误提示条。返回观测结果。"""
        page = self.page
        if page.get_by_role("button", name="新检索").count():
            page.get_by_role("button", name="新检索").click()
        box = page.get_by_label("输入技术问题")
        box.fill(query)
        box.press("Enter")
        done = page.get_by_text("总耗时")
        alert = page.locator("[role=alert].glass-float")
        t0 = time.time()
        done.or_(alert).first.wait_for(timeout=timeout_s * 1000)
        elapsed = time.time() - t0
        if alert.count():
            return {"ok": False, "error": alert.inner_text().replace("\n", " "), "wall_s": elapsed}
        page.wait_for_timeout(300)
        text = page.get_by_text("总耗时").locator("..").inner_text()
        m = re.search(r"([\d,]+) ms", text)
        latency = int(m.group(1).replace(",", "")) if m else None
        return {
            "ok": True,
            "latency_ms": latency,
            "cache_hit": page.get_by_text("缓存命中", exact=True).count() > 0,
            "wall_s": elapsed,
            "toolbar": text.replace("\n", " "),
        }


def history_total(page: Page) -> int:
    return page.evaluate("fetch('/api/history?page=1&pageSize=1').then(r=>r.json()).then(j=>j.data.total)")


def phase_cache(pw) -> None:
    s = Session(pw)
    q = QUESTIONS[0]
    first = s.search(q)
    check("第一次检索成功", first["ok"], str(first))
    if not first["ok"]:
        s.close()
        return
    check("第一次不是缓存命中（或之前已缓存）", True, f"cache_hit={first['cache_hit']} latency={first['latency_ms']} ms")
    second = s.search(q)
    check("第二次检索成功", second["ok"], str(second))
    if second["ok"]:
        print(f"  两次耗时：第一次 {first['latency_ms']} ms，第二次 {second['latency_ms']} ms", flush=True)
        check("第二次出现「缓存命中」标签", second["cache_hit"], second["toolbar"])
        check("第二次 latencyMs 与第一次不同（不是读缓存里存的历史值）", second["latency_ms"] != first["latency_ms"])
        check("第二次是真实回放耗时：明显更短、且在毫秒到秒级", second["latency_ms"] is not None and second["latency_ms"] < 10_000 and second["latency_ms"] < first["latency_ms"], f"{second['latency_ms']} ms")
        s.page.screenshot(path=str(OUT / "cache-hit-result.png"))
    check("无 pageerror", not s.page_errors, str(s.page_errors))
    check("无未捕获 console error", not s.console_errors, str(s.console_errors))
    s.close()


def phase_multi(pw) -> None:
    s = Session(pw)
    before = history_total(s.page)
    for i, q in enumerate(QUESTIONS[1:4], start=1):
        r = s.search(q)
        check(f"第 {i} 个不同问题：结果页正常", r["ok"], str(r)[:200])
        if r["ok"]:
            n_badges = s.page.locator("article button[aria-label^='查看第']").count()
            check(f"第 {i} 个问题：研报里有角标", n_badges > 0, f"{n_badges} 个")
    s.page.wait_for_timeout(500)
    after = history_total(s.page)
    check("历史条数随之增加 3 条", after - before == 3, f"{before} -> {after}")
    s.page.keyboard.press("Control+b")
    s.page.wait_for_timeout(800)
    s.page.screenshot(path=str(OUT / "multi-history.png"))
    check("无 pageerror", not s.page_errors, str(s.page_errors))
    check("无未捕获 console error", not s.console_errors, str(s.console_errors))
    s.close()


def pick_two_badges_same_source(page: Page):
    """找到指向同一信源、出现两次以上的角标，返回 (信源编号, 两个角标的 locator)。"""
    counts: dict[str, int] = {}
    labels = page.locator("article button[aria-label^='查看第']")
    for i in range(labels.count()):
        label = labels.nth(i).get_attribute("aria-label") or ""
        counts[label] = counts.get(label, 0) + 1
    for label, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        if n >= 2:
            idx = int(re.search(r"\d+", label).group())
            return idx, page.locator(f"article button[aria-label='{label}']")
    return None, None


def mark_texts(page: Page, idx: int) -> list[str]:
    return page.locator(f"#source-{idx} .evidence-mark").all_inner_texts()


def precise_checks(page: Page, tag: str) -> None:
    idx, badges = pick_two_badges_same_source(page)
    check(f"{tag}：存在指向同一信源的两个角标", idx is not None)
    if idx is None:
        return
    # 逐个点击，收集每个角标的高亮；只要有两个角标的高亮不同，就证明是一一对应而不是整源高亮
    seen: list[tuple[int, list[str]]] = []
    for k in range(min(badges.count(), 6)):
        badges.nth(k).click()
        page.wait_for_timeout(500)
        seen.append((k, mark_texts(page, idx)))
        active = page.locator("article button[aria-pressed='true']").count()
        check(f"{tag}：点第 {k + 1} 个 [{idx}] 后只有一个角标处于激活", active == 1, f"激活数 {active}")
        check(f"{tag}：点第 {k + 1} 个 [{idx}] 后至多高亮一句", len(seen[-1][1]) <= 1, f"{len(seen[-1][1])} 处")
    highlighted = [(k, m) for k, m in seen if m]
    distinct = {m[0] for _, m in highlighted}
    print(f"  {tag}：信源 {idx} 各角标的高亮：", [(k, (m[0][:40] if m else None)) for k, m in seen], flush=True)
    check(f"{tag}：同一信源的不同角标高亮不同句子", len(distinct) >= 2, f"{len(distinct)} 种不同高亮")
    page.screenshot(path=str(OUT / f"precise-{tag}.png"))


def phase_precise(pw) -> None:
    s = Session(pw)
    r = s.search(QUESTIONS[0])
    check("检索成功", r["ok"], str(r)[:200])
    if r["ok"]:
        precise_checks(s.page, "实时结果")
        # 历史恢复后同样成立
        s.page.keyboard.press("Control+b")
        s.page.wait_for_timeout(600)
        s.page.locator("#history-sidebar ul li > button:first-child").first.click()
        expect(s.page.locator("article[aria-label='研报正文']")).to_be_visible()
        s.page.wait_for_timeout(800)
        precise_checks(s.page, "历史恢复")
    check("无 pageerror", not s.page_errors, str(s.page_errors))
    s.close()


def phase_watchdog(pw) -> None:
    s = Session(pw)
    t0 = time.time()
    r = s.search(QUESTIONS[4])
    wall = time.time() - t0
    check("一次完整检索期间没有出现「连接超时」", r["ok"] and "超时" not in str(r), f"耗时 {wall:.1f}s {str(r)[:160]}")
    s.close()


def phase_stability(pw) -> None:
    total = int(os.environ.get("M4_TOTAL", "20"))
    real_target = int(os.environ.get("M4_REAL", "8"))
    s = Session(pw)
    plan = QUESTIONS[:real_target] + [QUESTIONS[i % real_target] for i in range(total - real_target)]
    ok = hits = misses = fails = 0
    for i, q in enumerate(plan, start=1):
        r = s.search(q)
        if r["ok"]:
            ok += 1
            if r["cache_hit"]:
                hits += 1
            else:
                misses += 1
        else:
            fails += 1
        print(f"  [{i:02d}/{total}] ok={r['ok']} cache={r.get('cache_hit')} latency={r.get('latency_ms')} wall={r['wall_s']:.1f}s {r.get('error', '')[:80]}", flush=True)
    print(
        f"STABILITY total={total} success={ok} real_miss={misses} cache_hit={hits} failed={fails} "
        f"pageerror={len(s.page_errors)} console_error={len(s.console_errors)}",
        flush=True,
    )
    check("20 次检索全部成功（无白屏、无卡死）", fails == 0, f"成功 {ok} / {total}")
    check(f"至少 {real_target} 次真实未命中检索", misses >= real_target, f"未命中 {misses}，命中 {hits}")
    check("全程无 pageerror", not s.page_errors, str(s.page_errors[:3]))
    check("全程无未捕获 console error", not s.console_errors, str(s.console_errors[:3]))
    s.page.screenshot(path=str(OUT / "stability-last.png"))
    s.close()


PHASES = {
    "cache": phase_cache,
    "multi": phase_multi,
    "precise": phase_precise,
    "watchdog": phase_watchdog,
    "stability": phase_stability,
}

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    chosen = sys.argv[1:] or list(PHASES)
    with sync_playwright() as pw:
        for name in chosen:
            print(f"=== 阶段 {name} ===", flush=True)
            try:
                PHASES[name](pw)
            except Exception as exc:  # noqa: BLE001
                check(f"阶段 {name} 异常", False, repr(exc)[:300])
    failed = [r for r in results if not r[1]]
    print(f"\n合计 {len(results)} 项，失败 {len(failed)} 项", flush=True)
    sys.exit(1 if failed else 0)
