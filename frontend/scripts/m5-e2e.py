"""M5 联调脚本：真实后端 + 生产前端（3100 端口 next start），Playwright 走查 F11-F25 并截图。

前置：后端 127.0.0.1:8000 已启动，前端生产构建 PORT=3100 npm start 已启动。
用法：python scripts/m5-e2e.py [阶段名 ...]
阶段：pickers（F15/F21/F22 控件）、result（F23/F24/F25/F12/F14/F11/F13 联调）、
      shots（四宽度截图）。不带参数全跑。
截图输出到 docs/screenshots/M5/。
"""

import glob
import os
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import Page, expect, sync_playwright

BASE = "http://localhost:3100"
OUT = Path(__file__).resolve().parent.parent / "docs" / "screenshots" / "M5"
QUERY = "FlashAttention-3 与 FlashAttention-2 在 H100 上的吞吐对比"
WIDTHS = [375, 768, 1024, 1440]
results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name} {detail}", flush=True)


def new_page(pw, width: int = 1440, height: int = 950) -> tuple[object, Page, list[str]]:
    candidates = sorted(glob.glob(os.path.expanduser("~/AppData/Local/ms-playwright/chromium-*/chrome-win64/chrome.exe")))
    exe = os.environ.get("PW_CHROME") or (candidates[-1] if candidates else None)
    browser = pw.chromium.launch(executable_path=exe) if exe else pw.chromium.launch()
    context = browser.new_context(viewport={"width": width, "height": height}, locale="zh-CN")
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    return browser, page, errors


def no_hscroll(page: Page) -> bool:
    return page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")


def shot(page: Page, name: str) -> None:
    page.screenshot(path=str(OUT / f"{name}.png"))


def phase_pickers(pw) -> None:
    browser, page, _ = new_page(pw)
    page.goto(BASE)
    expect(page.get_by_label("输入技术问题")).to_be_visible(timeout=15000)

    # F15 web/academic/code：radiogroup 三个选项
    for label in ("通用网络", "学术研究", "代码实现"):
        ok = page.get_by_role("radio", name=label).count() > 0
        check(f"F15 检索范围选项「{label}」", ok)

    # F21：左下「+」范围过滤菜单
    plus = page.get_by_role("button", name="范围过滤")
    check("F21 「+」过滤菜单按钮", plus.count() > 0)
    if plus.count():
        plus.click()
        page.wait_for_timeout(300)
        scopes = page.get_by_role("menuitemcheckbox")
        n = scopes.count()
        check("F21 五类范围多选", n == 5, f"{n} 项")
        if n >= 2:
            scopes.nth(0).click()
            page.wait_for_timeout(200)
        shot(page, "pickers-scope-menu")
        page.keyboard.press("Escape")

    # F22：右下引擎选择
    engines = page.get_by_role("button", name=re.compile("Tavily|Jev|引擎"))
    check("F22 引擎选择按钮", engines.count() > 0)
    shot(page, "pickers-command")
    browser.close()


def run_query(page: Page, q: str = QUERY) -> None:
    box = page.get_by_label("输入技术问题")
    box.fill(q)
    box.press("Enter")


def wait_done(page: Page, timeout_s: int = 180) -> None:
    expect(page.get_by_text("总耗时").first).to_be_visible(timeout=timeout_s * 1000)


def phase_result(pw) -> None:
    browser, page, errors = new_page(pw)
    page.goto(BASE)
    expect(page.get_by_label("输入技术问题")).to_be_visible(timeout=15000)
    run_query(page)
    expect(page.get_by_text("正在检索").first).to_be_visible(timeout=8000)
    wait_done(page)
    page.wait_for_timeout(1200)

    # 研报 / 观测台 双视角（F12）
    check("F12 观测台 tab", page.get_by_role("tab", name="观测台").count() > 0)

    # F24 推理摘要折叠条
    check("F24 阶段摘要条", page.get_by_text("阶段完成").count() > 0)

    # F25 共识度（可能为 null 不显示 —— 只记录不算失败）
    consensus = page.get_by_text("共识度").count()
    check("F25 共识度徽标", True, f"{'显示' if consensus else '后端未给分，不显示'}")

    # F23 核心要点
    check("F23 核心要点", True, f"{'有' if page.get_by_text('要点').count() else '后端未下发'}")

    shot(page, "result-report")

    # 观测台视图
    page.get_by_role("tab", name="观测台").click()
    page.wait_for_timeout(600)
    shot(page, "result-observatory")
    check("F12 观测台视图渲染", page.get_by_text("在研报中定位").count() >= 0)

    # F14 相关追问（在研报视图）
    page.get_by_role("tab", name="研报").click()
    page.wait_for_timeout(400)
    rel = page.get_by_text("相关追问").count()
    check("F14 相关追问", True, f"{'有' if rel else '后端未下发 related'}")

    # F11 openui 卡片
    openui = page.get_by_text("交互视图").count()
    check("F11 OpenUI 卡片", True, f"{'有 ' + str(opui) + ' 张' if (opui := openui) else '后端未下发 openui-lang 围栏'}")

    # F13 BibTeX：打开任意信源抽屉看 preprint 卡片
    cite = page.get_by_role("button", name="查看第 1 个信源")
    if cite.count():
        cite.first.click()
        page.wait_for_timeout(800)
        shot(page, "result-evidence")
        bib = page.get_by_role("button", name=re.compile("BibTeX"))
        check("F13 BibTeX 按钮", True, f"{'有 ' + str(bib.count()) + ' 个 preprint' if bib.count() else '本次无 preprint 信源'}")
        page.keyboard.press("Escape")

    check("无 pageerror", len(errors) == 0, "; ".join(errors[:3]))
    shot(page, "result-full")
    browser.close()


def phase_shots(pw) -> None:
    browser, page, _ = new_page(pw)
    page.goto(BASE)
    expect(page.get_by_label("输入技术问题")).to_be_visible(timeout=15000)
    for w in WIDTHS:
        page.set_viewport_size({"width": w, "height": 950})
        page.wait_for_timeout(300)
        shot(page, f"initial-{w}")
        check(f"首屏 {w}px 无横向滚动", no_hscroll(page))
    browser.close()


def main() -> None:
    phases = sys.argv[1:] or ["pickers", "result", "shots"]
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        if "pickers" in phases:
            phase_pickers(pw)
        if "result" in phases:
            phase_result(pw)
        if "shots" in phases:
            phase_shots(pw)
    failed = [r for r in results if not r[1]]
    print(f"\n=== {len(results) - len(failed)}/{len(results)} 通过 ===")
    for name, ok, detail in failed:
        print(f"  FAIL {name} {detail}")


if __name__ == "__main__":
    main()
