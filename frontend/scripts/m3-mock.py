"""M3 开发期 mock 场景验证：生成中途 error、45 秒静默（看门狗）、[99] 幻觉角标与不完整正文。

前置：以开发模式启动前端并打开 mock 开关（后端可以不启动）：
    set NEXT_PUBLIC_USE_MOCK=1 && npx next dev -p 3100
用法：python scripts/m3-mock.py [error|silence|hallucination ...]
"""

import glob
import os
import sys
import time
from pathlib import Path

from playwright.sync_api import Page, expect, sync_playwright

BASE = "http://localhost:3100"
OUT = Path(__file__).resolve().parent.parent / "docs" / "screenshots" / "M3"
results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name} {detail}", flush=True)


def open_page(pw, scenario: str) -> tuple[object, Page]:
    candidates = sorted(glob.glob(os.path.expanduser("~/AppData/Local/ms-playwright/chromium-*/chrome-win64/chrome.exe")))
    exe = os.environ.get("PW_CHROME") or (candidates[-1] if candidates else None)
    browser = pw.chromium.launch(executable_path=exe) if exe else pw.chromium.launch()
    page = browser.new_context(viewport={"width": 1440, "height": 900}, locale="zh-CN").new_page()
    page.goto(f"{BASE}/?mock={scenario}")
    box = page.get_by_label("输入技术问题")
    box.fill("mock 场景问题")
    box.press("Enter")
    return browser, page


def scenario_error(pw) -> None:
    browser, page = open_page(pw, "error")
    expect(page.locator("[role=alert].glass-float")).to_be_visible(timeout=10000)
    article = page.locator("article[aria-label='研报正文']")
    text = article.inner_text()
    alert = page.locator("[role=alert].glass-float").inner_text()
    check("生成中途 error：留在结果页并保留已生成内容", "FP8 内核" in text and "TMA 拷贝" in text, text.replace("\n", " ")[:60])
    check("error 事件的原因显示在提示条", "模型服务连接被重置" in alert, alert.replace("\n", " "))
    check("retryable=true：显示重试按钮", page.get_by_role("button", name="重试").count() == 1)
    check("不再显示生成中标记", page.get_by_text("生成中").count() == 0)
    page.screenshot(path=str(OUT / "mock-error-mid-generation.png"))
    browser.close()


def scenario_hallucination(pw) -> None:
    browser, page = open_page(pw, "hallucination")
    expect(page.get_by_text("总耗时")).to_be_visible(timeout=10000)
    article = page.locator("article[aria-label='研报正文']")
    html = article.inner_html()
    check("[99] 幻觉角标按纯文本显示", "[99]" in article.inner_text() and "查看第 99 个信源" not in html)
    check("合法的 [1] 渲染为角标", "查看第 1 个信源" in html)
    check("流式被切开的 [3 + ] 补全后识别为角标", "查看第 3 个信源" in html)
    check("未闭合的代码围栏不导致空白或报错", article.inner_text().strip() != "" and page.get_by_role("button", name="返回首页", exact=True).count() == 0)
    # done 之后高亮：偏移按 UTF-16 码元 slice；同一信源的两个角标分别对应不同的句子（M4 精确对应）
    badges = page.locator("article button[aria-label='查看第 1 个信源']")
    check("同一信源有两个角标", badges.count() == 2, f"{badges.count()} 个")
    badges.nth(0).click()
    page.wait_for_timeout(600)
    marks = page.locator("#source-1 .evidence-mark")
    check("点第一个 [1]：只高亮第一句（中文）", marks.count() == 1 and marks.first.inner_text() == "FP8 内核在 Hopper 上的吞吐取决于张量核心的调度方式。", marks.first.inner_text())
    badges.nth(1).click()
    page.wait_for_timeout(600)
    marks = page.locator("#source-1 .evidence-mark")
    check("点第二个 [1]：高亮换成第二句，第一句的高亮被清掉", marks.count() == 1 and marks.first.inner_text() == "后面还有一句补充说明。", marks.first.inner_text())
    check("只有被点击的那个角标处于激活状态", page.locator("article button[aria-pressed='true']").count() == 1)
    badges.nth(0).click()
    page.wait_for_timeout(400)
    check("再点第一个 [1]：回到第一句", page.locator("#source-1 .evidence-mark").first.inner_text().startswith("FP8"))
    page.screenshot(path=str(OUT / "mock-hallucination.png"))
    browser.close()


def scenario_silence(pw) -> None:
    browser, page = open_page(pw, "silence")
    expect(page.get_by_text("正在检索")).to_be_visible(timeout=5000)
    t0 = time.time()
    expect(page.locator("[role=alert].glass-float")).to_be_visible(timeout=60000)
    waited = time.time() - t0
    alert = page.locator("[role=alert].glass-float").inner_text()
    check("静默 45 秒触发看门狗，报连接超时", "超时" in alert, f"等待 {waited:.1f}s：{alert.replace(chr(10), ' ')}")
    check("看门狗在 40-50 秒之间触发", 40 <= waited <= 50, f"{waited:.1f}s")
    check("检索阶段超时：回到 initial 并保留问题", page.get_by_label("输入技术问题").input_value() == "mock 场景问题")
    check("可重试", page.get_by_role("button", name="重试").count() == 1)
    page.screenshot(path=str(OUT / "mock-silence-timeout.png"))
    browser.close()


SCENARIOS = {"error": scenario_error, "hallucination": scenario_hallucination, "silence": scenario_silence}

if __name__ == "__main__":
    chosen = sys.argv[1:] or list(SCENARIOS)
    with sync_playwright() as pw:
        for name in chosen:
            print(f"=== 场景 {name} ===", flush=True)
            try:
                SCENARIOS[name](pw)
            except Exception as exc:  # noqa: BLE001
                check(f"场景 {name} 异常", False, repr(exc)[:300])
    failed = [r for r in results if not r[1]]
    print(f"\n合计 {len(results)} 项，失败 {len(failed)} 项", flush=True)
    sys.exit(1 if failed else 0)
