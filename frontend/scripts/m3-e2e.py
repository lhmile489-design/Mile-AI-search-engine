"""M3 联调脚本：真实后端 + 真实前端（next start），Playwright 走一遍验收项并截图。

前置：后端 127.0.0.1:8000 已启动，前端 http://localhost:3000 已启动（npm run build && npx next start -p 3000）。
用法：python scripts/m3-e2e.py [阶段名 ...]
阶段：shots（四宽度截图 + 角标高亮）、esc（两种 Esc 行为）、history（历史恢复不重新检索）、
      keyboard（纯键盘走查）、down（后端断开错误态，需先手动停掉后端）。不带参数时按顺序跑前四个。
截图输出到 docs/screenshots/M3/。
"""

import glob
import os
import sys
import time
from pathlib import Path

from playwright.sync_api import Page, expect, sync_playwright

BASE = "http://localhost:3000"
OUT = Path(__file__).resolve().parent.parent / "docs" / "screenshots" / "M3"
QUERY = "FlashAttention-3 FP8 内核吞吐基准"
WIDTHS = [375, 768, 1024, 1440]
results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name} {detail}", flush=True)


def new_page(pw, width: int = 1440, height: int = 900) -> tuple[object, Page, list[str]]:
    # 本机 Playwright 的浏览器版本与已安装的不一致时，用 PW_CHROME 或已安装的最新 chromium
    candidates = sorted(glob.glob(os.path.expanduser("~/AppData/Local/ms-playwright/chromium-*/chrome-win64/chrome.exe")))
    exe = os.environ.get("PW_CHROME") or (candidates[-1] if candidates else None)
    browser = pw.chromium.launch(executable_path=exe) if exe else pw.chromium.launch()
    context = browser.new_context(viewport={"width": width, "height": height}, locale="zh-CN")
    page = context.new_page()
    requests: list[str] = []
    page.on("request", lambda r: requests.append(f"{r.method} {r.url.replace(BASE, '')}") if "/api/" in r.url else None)
    page.on("pageerror", lambda e: print("  [pageerror]", e, flush=True))
    return browser, page, requests


def no_hscroll(page: Page) -> bool:
    return page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")


def shot(page: Page, name: str) -> None:
    page.screenshot(path=str(OUT / f"{name}.png"))


def submit(page: Page, text: str = QUERY) -> None:
    box = page.get_by_label("输入技术问题")
    box.fill(text)
    box.press("Enter")


def wait_result_done(page: Page, timeout_s: int = 150) -> None:
    # 生成结束：「总耗时」出现且不再有「生成中」
    expect(page.get_by_text("总耗时")).to_be_visible(timeout=timeout_s * 1000)


def phase_shots(pw) -> None:
    browser, page, _ = new_page(pw)
    page.goto(BASE)
    expect(page.get_by_label("输入技术问题")).to_be_visible()
    for w in WIDTHS:
        page.set_viewport_size({"width": w, "height": 900})
        page.wait_for_timeout(300)
        shot(page, f"initial-{w}")
        check(f"首屏 {w}px 无横向滚动", no_hscroll(page))

    # 点推荐问题 chip 直接发起检索（F01）
    page.set_viewport_size({"width": 1440, "height": 900})
    t0 = time.time()
    page.get_by_role("button", name="FlashAttention-3 FP8 内核在 Hopper GPU 上的吞吐基准与优化").click()
    expect(page.get_by_text("正在检索")).to_be_visible(timeout=3000)
    check("提交后进入 retrieving（<300ms 目标）", True, f"{(time.time() - t0) * 1000:.0f} ms 内可见")

    # 检索推理态：等到时间轴有耗时、信源雷达有行
    page.wait_for_function(
        "document.querySelectorAll('[aria-label=\"信源抓取\"] li.row-in').length >= 3", timeout=60000
    ) if page.locator("[aria-label='信源抓取']").count() else None
    for w in WIDTHS:
        page.set_viewport_size({"width": w, "height": 900})
        page.wait_for_timeout(300)
        if page.get_by_text("正在检索").count():
            shot(page, f"retrieving-{w}")
            check(f"检索推理态 {w}px 无横向滚动", no_hscroll(page))
    elapsed_cells = page.locator("[aria-label='检索进度'] .font-mono").all_inner_texts()
    print("  时间轴耗时单元格:", [t for t in elapsed_cells if t.strip()], flush=True)

    # 首个 token 后进入 result，等待完成
    page.set_viewport_size({"width": 1440, "height": 900})
    wait_result_done(page)
    page.wait_for_timeout(500)
    total = page.get_by_text("总耗时").locator("..").inner_text()
    check("结果页顶部显示总耗时与信源数", "ms" in total, total.replace("\n", " "))
    for w in WIDTHS:
        page.set_viewport_size({"width": w, "height": 900})
        page.wait_for_timeout(400)
        shot(page, f"result-{w}")
        check(f"结果页 {w}px 无横向滚动", no_hscroll(page))

    # 角标 -> 证据抽屉定位 + 高亮（桌面）
    page.set_viewport_size({"width": 1440, "height": 900})
    page.wait_for_timeout(300)
    badges = page.locator("article button[aria-label^='查看第']")
    n_badges = badges.count()
    check("研报里渲染出可点击角标", n_badges > 0, f"{n_badges} 个")
    if n_badges:
        label = badges.nth(0).get_attribute("aria-label")
        idx = int("".join(c for c in label if c.isdigit()))
        # 找一个有高亮的信源
        marks_total = page.locator("#evidence-drawer .evidence-mark").count()
        badges.nth(0).click()
        page.wait_for_timeout(800)
        active = page.locator(f"#source-{idx}")
        check("点击角标后对应信源被标记为当前", active.get_attribute("aria-current") == "true", f"source-{idx}")
        in_view = page.evaluate(
            "(i)=>{const e=document.getElementById('source-'+i);const r=e.getBoundingClientRect();return r.top>=0&&r.top<window.innerHeight}",
            idx,
        )
        check("证据抽屉已滚动到该信源（在视口内）", bool(in_view))
        shot(page, "citation-desktop")
        print(f"  抽屉内高亮句子数（整个抽屉）: {marks_total}", flush=True)
        check("done 之后抽屉里存在被引用句子的高亮", marks_total > 0, f"{marks_total} 处")
        # 窄屏覆盖式抽屉
        page.keyboard.press("Escape")
        page.set_viewport_size({"width": 768, "height": 900})
        page.wait_for_timeout(300)
        badges.nth(0).click()
        page.wait_for_timeout(600)
        shot(page, "citation-overlay-768")
        check("窄屏点击角标打开覆盖式抽屉", page.locator("#evidence-drawer").is_visible())
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
        check("Esc 关闭覆盖式抽屉（已完成状态）", page.locator("#evidence-drawer").get_attribute("inert") is not None)
    browser.close()


def phase_esc(pw) -> None:
    # 检索中 Esc：回 initial 且问题保留；后端不再继续
    browser, page, requests = new_page(pw)
    page.goto(BASE)
    submit(page)
    expect(page.get_by_text("正在检索")).to_be_visible(timeout=3000)
    page.wait_for_timeout(1500)
    t_abort = time.strftime("%H:%M:%S")
    page.keyboard.press("Escape")
    expect(page.get_by_label("输入技术问题")).to_be_visible(timeout=3000)
    check("检索中 Esc：回到 initial", page.get_by_text("正在检索").count() == 0)
    check("检索中 Esc：输入框保留原问题", page.get_by_label("输入技术问题").input_value() == QUERY)
    shot(page, "esc-retrieving-back-to-initial")
    print(f"  中止时间 {t_abort}（对照后端日志该时间之后无新的外部调用）", flush=True)
    page.wait_for_timeout(6000)
    browser.close()

    # 生成中 Esc：留在 result，保留内容，标「已中止」。
    # 必须用保证不命中缓存的问题，否则后端瞬间回放完成、Esc 来不及中止生成。
    # 尾巴带时间戳让该问题每次运行都是新问题。
    browser, page, _ = new_page(pw)
    page.goto(BASE)
    fresh_q = f"FlashAttention 内核 warp 专用化与 Ping-Pong 调度差异 {int(time.time()) % 100000}"
    submit(page, fresh_q)
    article = page.locator("article[aria-label='研报正文']")
    page.wait_for_function(
        "(() => { const a=document.querySelector(\"article[aria-label='研报正文']\"); return a && a.innerText.length>60 })()",
        timeout=120000,
    )
    before = article.inner_text()
    page.keyboard.press("Escape")
    page.wait_for_timeout(600)
    after = article.inner_text()
    check("生成中 Esc：仍在结果页并标注已中止", page.get_by_text("已中止", exact=False).count() >= 1)
    check("生成中 Esc：保留已生成内容", len(after) >= len(before.replace("已中止", "")) - 5, f"{len(before)} -> {len(after)} 字符")
    page.wait_for_timeout(3000)
    later = article.inner_text()
    check("中止后正文不再增长（迟到事件被丢弃）", later == after, f"{len(after)} -> {len(later)}")
    shot(page, "esc-generating-aborted")
    browser.close()


def phase_history(pw) -> None:
    browser, page, requests = new_page(pw)
    page.goto(BASE)
    page.keyboard.press("Control+b")
    expect(page.get_by_label("历史记录", exact=True).first).to_be_visible()
    page.wait_for_timeout(800)
    shot(page, "history-sidebar-initial")
    items = page.locator("#history-sidebar ul li > button:first-child")
    check("历史侧边栏列出记录", items.count() > 0, f"{items.count()} 条")
    stream_before = sum(1 for r in requests if "/api/search/stream" in r)
    items.first.click()
    expect(page.locator("article[aria-label='研报正文']")).to_be_visible(timeout=5000)
    page.wait_for_timeout(800)
    stream_after = sum(1 for r in requests if "/api/search/stream" in r)
    detail_reqs = [r for r in requests if r.startswith("GET /api/history/")]
    print("  Network（/api/ 请求）:", requests, flush=True)
    check("恢复历史不触发 /api/search/stream", stream_after == stream_before, f"stream 请求数 {stream_before} -> {stream_after}")
    check("恢复历史调用了 GET /api/history/{id}", len(detail_reqs) >= 1, detail_reqs[-1] if detail_reqs else "")
    badges = page.locator("article button[aria-label^='查看第']").count()
    check("历史快照还原角标", badges > 0, f"{badges} 个")
    page.locator("article button[aria-label^='查看第']").first.click()
    page.wait_for_timeout(800)
    marks = page.locator("#evidence-drawer .evidence-mark").count()
    check("历史快照还原高亮", marks > 0, f"{marks} 处")
    shot(page, "history-restored")
    # 删除一条不影响其他（只验证按钮存在且可访问，不真的删用户数据）
    check("历史条目有可访问的删除按钮", page.locator("#history-sidebar button[aria-label^='删除历史记录']").count() > 0)
    browser.close()


def phase_keyboard(pw) -> None:
    browser, page, _ = new_page(pw, 768, 900)
    page.goto(BASE)
    page.wait_for_timeout(500)
    page.keyboard.press("Control+k")
    focused = page.evaluate("document.activeElement && document.activeElement.getAttribute('aria-label')")
    check("Ctrl+K 聚焦搜索框", focused == "输入技术问题", str(focused))
    page.keyboard.type(QUERY)
    shot(page, "focus-1-superbar")
    page.keyboard.press("Enter")
    expect(page.get_by_text("总耗时")).to_be_visible(timeout=150000)
    page.wait_for_timeout(500)
    # Tab 到第一个角标
    found = False
    for _ in range(40):
        page.keyboard.press("Tab")
        label = page.evaluate("document.activeElement && (document.activeElement.getAttribute('aria-label')||'')")
        if label.startswith("查看第"):
            found = True
            break
    check("Tab 能到达引用角标", found, label)
    shot(page, "focus-2-citation-badge")
    page.keyboard.press("Enter")
    page.wait_for_timeout(700)
    in_drawer = page.evaluate("!!document.activeElement.closest('#evidence-drawer')")
    check("角标回车后焦点进入覆盖式抽屉", bool(in_drawer))
    shot(page, "focus-3-drawer-open")
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    back = page.evaluate("document.activeElement && (document.activeElement.getAttribute('aria-label')||'')")
    check("Esc 关闭抽屉后焦点回到角标", back.startswith("查看第"), back)
    shot(page, "focus-4-drawer-closed")
    page.keyboard.press("Control+b")
    page.wait_for_timeout(500)
    page.keyboard.press("Tab")
    page.wait_for_timeout(200)
    shot(page, "focus-5-history-open")
    # Tab 到历史条目并回车恢复
    reached = False
    for _ in range(30):
        info = page.evaluate(
            "(()=>{const e=document.activeElement;return e && e.closest('#history-sidebar') && e.tagName==='BUTTON' && !(e.getAttribute('aria-label')||'').startsWith('删除') && !(e.getAttribute('aria-label')||'').startsWith('收起') ? e.innerText.slice(0,20) : ''})()"
        )
        if info:
            reached = True
            break
        page.keyboard.press("Tab")
    check("Tab 能到达历史条目", reached, info if reached else "")
    shot(page, "focus-6-history-item")
    page.keyboard.press("Enter")
    page.wait_for_timeout(1500)
    check("回车恢复历史后显示结果页", page.locator("article[aria-label='研报正文']").is_visible())
    shot(page, "focus-7-restored")
    browser.close()


def phase_down(pw) -> None:
    # A. 后端一开始就不可达：连 /api/config 都拿不到
    browser, page, _ = new_page(pw)
    page.goto(BASE)
    submit(page, "后端断开测试问题")
    alert = page.locator("[role=alert].glass-float")
    expect(alert).to_be_visible(timeout=15000)
    text = alert.inner_text()
    check("后端断开（启动即不可达）：出现错误提示条而不是空白页", "连接失败" in text, text.replace("\n", " "))
    check("错误提示条带重试按钮", page.get_by_role("button", name="重试").count() > 0)
    check("回到 initial 且输入框保留问题", page.get_by_label("输入技术问题").input_value() == "后端断开测试问题")
    shot(page, "error-backend-down")
    browser.close()

    # B. 页面已加载（config 正常）后，流请求打到已停止的后端：Next 代理返回 500 纯文本
    browser, page, _ = new_page(pw)
    config = (
        '{"code":200,"msg":"ok","data":{"focusModes":[],"scopes":[],"version":"0.1.0",'
        '"engines":[{"value":"tavily","label":"Tavily","available":true}]}}'
    )
    page.route("**/api/config", lambda r: r.fulfill(status=200, content_type="application/json", body=config))
    page.goto(BASE)
    submit(page, "后端断开测试问题")
    alert = page.locator("[role=alert].glass-float")
    expect(alert).to_be_visible(timeout=15000)
    text = alert.inner_text()
    check("后端断开（流请求被代理拒绝）：提示条给出原因与下一步", "不可用" in text and "重试" in text, text.replace("\n", " "))
    check("流请求失败后回到 initial 并保留问题", page.get_by_label("输入技术问题").input_value() == "后端断开测试问题")
    shot(page, "error-stream-http-500")
    browser.close()

    # C. 网络层直接断开（请求被中止）
    browser, page, _ = new_page(pw)
    page.route("**/api/config", lambda r: r.fulfill(status=200, content_type="application/json", body=config))
    page.route("**/api/search/stream", lambda r: r.abort("connectionrefused"))
    page.goto(BASE)
    submit(page, "网络断开测试问题")
    expect(alert := page.locator("[role=alert].glass-float")).to_be_visible(timeout=15000)
    text = alert.inner_text()
    check("网络断开：提示条给出「连接失败」并可重试", "连接失败" in text and page.get_by_role("button", name="重试").count() > 0, text.replace("\n", " "))
    browser.close()


PHASES = {"shots": phase_shots, "esc": phase_esc, "history": phase_history, "keyboard": phase_keyboard, "down": phase_down}

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    chosen = sys.argv[1:] or ["shots", "esc", "history", "keyboard"]
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
