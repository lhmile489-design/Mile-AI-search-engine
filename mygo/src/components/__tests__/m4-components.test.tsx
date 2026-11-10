import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeronStepper } from "@/components/search/HeronStepper";
import { ResultToolbar } from "@/components/search/ResultToolbar";
import { Superbar } from "@/components/search/Superbar";
import { createIdleSteps, type StepState } from "@/store/state";

const toolbar = (over: Partial<Parameters<typeof ResultToolbar>[0]> = {}) =>
  renderToStaticMarkup(
    <ResultToolbar
      query="问题"
      generating={false}
      aborted={false}
      latencyMs={42}
      sourceCount={3}
      cacheHit={false}
      restoredFromHistory={false}
      {...over}
    />,
  );

describe("ResultToolbar：缓存命中标签", () => {
  it("cacheHit=true：显示「缓存命中」，耗时仍是后端给的数字", () => {
    const html = toolbar({ cacheHit: true, latencyMs: 42 });
    expect(html).toContain("缓存命中");
    expect(html).toContain("42 ms");
  });

  it("cacheHit=false：不显示标签", () => {
    expect(toolbar({ cacheHit: false })).not.toContain("缓存命中");
  });

  it("历史恢复且命中：同样显示，并标注来自历史记录", () => {
    const html = toolbar({ cacheHit: true, restoredFromHistory: true });
    expect(html).toContain("缓存命中");
    expect(html).toContain("来自历史记录");
  });

  it("生成中显示「生成中」而不是耗时", () => {
    const html = toolbar({ generating: true, latencyMs: null });
    expect(html).toContain("生成中");
    expect(html).not.toContain("总耗时");
  });
});

const steps = (patch: Partial<Record<"rewriting" | "searching" | "reasoning" | "generating", Partial<StepState>>>) => {
  const base = createIdleSteps();
  for (const [name, value] of Object.entries(patch)) {
    const key = name as keyof typeof base;
    base[key] = { ...base[key], ...value };
  }
  return base;
};

describe("HeronStepper：缓存标注", () => {
  it("所有已开始的阶段都命中：标题处显示「缓存命中」，耗时照常显示", () => {
    const html = renderToStaticMarkup(
      <HeronStepper
        steps={steps({
          rewriting: { status: "done", elapsedMs: 3, cacheHit: true },
          searching: { status: "running", cacheHit: true },
        })}
        rewrittenQueries={[]}
      />,
    );
    expect(html).toContain("缓存命中");
    expect(html).toContain("3 ms");
  });

  it("只有个别阶段命中（子检索词缓存）：只在该阶段标注，标题处不显示整体标签", () => {
    const html = renderToStaticMarkup(
      <HeronStepper
        steps={steps({
          rewriting: { status: "done", elapsedMs: 800, cacheHit: false },
          searching: { status: "done", elapsedMs: 5, cacheHit: true },
        })}
        rewrittenQueries={[]}
      />,
    );
    expect(html).toContain("（缓存命中）");
    expect(html.match(/缓存命中/g)).toHaveLength(1);
  });

  it("没有任何命中：不出现缓存文案", () => {
    const html = renderToStaticMarkup(
      <HeronStepper steps={steps({ rewriting: { status: "done", elapsedMs: 800 } })} rewrittenQueries={[]} />,
    );
    expect(html).not.toContain("缓存命中");
  });
});

describe("Superbar：没有可用引擎时停用提交", () => {
  const render = (blockedReason: string | null, value = "有内容的问题") =>
    renderToStaticMarkup(
      <Superbar value={value} onChange={() => {}} onSubmit={() => {}} inputRef={createRef()} blockedReason={blockedReason} />,
    );

  it("blockedReason 有值：提交按钮 disabled，并显示原因", () => {
    const html = render("没有可用的检索引擎，请检查后端密钥配置");
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*aria-label="提交检索"|<button[^>]*aria-label="提交检索"[^>]*\sdisabled=""/);
    expect(html).toContain("没有可用的检索引擎，请检查后端密钥配置");
  });

  it("没有 blockedReason 且有内容：提交按钮可用", () => {
    const html = render(null);
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""/);
  });
});
