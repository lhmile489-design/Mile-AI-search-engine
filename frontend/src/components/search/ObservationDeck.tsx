"use client";

import { cn } from "@/lib/cn";
import { formatMs } from "@/lib/format";
import { CategoryTag } from "./CategoryTag";
import { Favicon } from "./Favicon";
import type { SearchState } from "@/store/state";
import { STEP_ORDER, type SourceCard } from "@/types";

// F12：推演观测台。结果页的第二个视角，完整展示推理过程：
// 四阶段时间轴与耗时、改写出的子检索词、每个信源的三项分数与总分、
// 分类来源与置信度、降级与缓存命中标注。
// 所有数字来自后端事件，不自己算、不写占位。

const STEP_LABEL: Readonly<Record<string, string>> = {
  rewriting: "改写检索词",
  searching: "检索",
  reasoning: "分类重排",
  generating: "生成研报",
};

const STEP_STATUS_TEXT: Readonly<Record<string, string>> = {
  idle: "等待中",
  running: "进行中",
  done: "已完成",
  failed: "失败",
};

function scoreText(value: number | null): string {
  return value === null ? "—" : value.toFixed(3);
}

function TimingBar({ label, elapsedMs, maxMs, cacheHit, status }: Readonly<{ label: string; elapsedMs: number | null; maxMs: number; cacheHit: boolean; status: string }>) {
  const pct = elapsedMs !== null && maxMs > 0 ? Math.min(100, (elapsedMs / maxMs) * 100) : 0;
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-ui font-semibold text-ink">
          {label}
          {cacheHit ? (
            <span className="ml-2 rounded-pill bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-soft-ink">缓存</span>
          ) : null}
        </span>
        <span className="font-mono text-sm tabular-nums text-ink-soft">
          {elapsedMs !== null ? formatMs(elapsedMs) : STEP_STATUS_TEXT[status] ?? status}
        </span>
      </div>
      <div className="mt-1.5 h-2 rounded-pill bg-surface-sunk" role="img" aria-label={`${label} 耗时 ${elapsedMs ?? 0} ms`}>
        <div className="h-full rounded-pill bg-accent transition-[width] duration-base" style={{ width: `${pct}%` }} />
      </div>
    </li>
  );
}

function SourceRow({ source, onLocate, categoryLabel }: Readonly<{ source: SourceCard; onLocate: (index: number) => void; categoryLabel: (c: string) => string }>) {
  const s = source.scores;
  return (
    <li className="border-t border-line py-4 first:border-t-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex min-w-5 shrink-0 justify-center rounded-xs bg-accent-soft px-1 text-xs font-bold leading-5 text-accent-soft-ink">
              {source.index}
            </span>
            <Favicon url={source.faviconUrl} />
            <span className="truncate font-mono text-sm text-ink">{source.domain}</span>
            <CategoryTag label={categoryLabel(source.category)} />
          </div>
          <p className="mt-1.5 truncate text-sm text-ink-soft" title={source.title}>{source.title}</p>
        </div>
        {source.index !== null ? (
          <button
            type="button"
            onClick={() => onLocate(source.index as number)}
            className="shrink-0 cursor-pointer rounded-md px-2 py-1 text-sm font-semibold text-accent-deep hover:bg-accent-tint-hover"
          >
            在研报中定位
          </button>
        ) : null}
      </div>
      <dl className="mt-2.5 grid grid-cols-4 gap-2 text-center">
        {(
          [
            ["相关性", s.relevance],
            ["权威度", s.authority],
            ["时效性", s.freshness],
            ["总分", s.final],
          ] as const
        ).map(([label, v]) => (
          <div key={label} className="rounded-md bg-surface-sunk px-1 py-1.5">
            <dt className="text-xs font-semibold text-ink-muted">{label}</dt>
            <dd className={cn("mt-0.5 font-mono text-sm font-semibold tabular-nums", v === null ? "text-ink-faint" : "text-ink")}>
              {scoreText(v)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
        <span>分类来源：{source.categorySource === "rule" ? "本地规则" : "模型"}</span>
        <span>规则：{source.categoryRule}</span>
        {source.confidence !== null ? <span>置信度 {source.confidence.toFixed(2)}</span> : null}
        {source.matchedQueries.length > 0 ? <span>命中检索词 {source.matchedQueries.map((i) => `#${i + 1}`).join("、")}</span> : null}
      </p>
    </li>
  );
}

export type ObservationDeckProps = Readonly<{
  state: SearchState;
  categoryLabel: (category: string) => string;
  /** 点信源切回研报并定位 */
  onLocateSource: (index: number) => void;
}>;

export function ObservationDeck({ state, categoryLabel, onLocateSource }: ObservationDeckProps) {
  const timings = state.stageTimings;
  const steps = state.steps;
  const elapsedList = STEP_ORDER.map((n) => steps[n].elapsedMs ?? 0);
  const maxMs = Math.max(...elapsedList, 1);
  const degraded = STEP_ORDER.map((n) => steps[n]).find((s) => s.degraded)?.degraded;

  return (
    <section aria-label="推演观测台" className="grid gap-6 lg:grid-cols-5 lg:items-start">
      {/* 左：阶段全景 */}
      <div className="rounded-card bg-surface px-6 py-7 shadow-e2 lg:col-span-2">
        <h2 className="font-display text-lg font-bold">阶段耗时</h2>
        <ul className="mt-5 grid gap-4">
          {STEP_ORDER.map((name) => (
            <TimingBar
              key={name}
              label={STEP_LABEL[name]}
              elapsedMs={steps[name].elapsedMs}
              maxMs={maxMs}
              cacheHit={steps[name].cacheHit}
              status={steps[name].status}
            />
          ))}
        </ul>
        {timings?.finalizingMs !== undefined && timings !== null ? (
          <p className="mt-4 border-t border-line pt-3 text-sm text-ink-muted">
            收尾（引用解析 / 要点 / 写库）<span className="font-mono tabular-nums">{formatMs(timings.finalizingMs)}</span>
          </p>
        ) : null}
        {state.latencyMs !== null ? (
          <p className="mt-1 text-sm text-ink-muted">
            总耗时 <span className="font-mono font-semibold tabular-nums text-ink">{formatMs(state.latencyMs)}</span>
          </p>
        ) : null}

        {state.rewrittenQueries.length > 0 ? (
          <>
            <h3 className="mt-6 font-display text-base font-bold">改写出的检索词</h3>
            <ul className="mt-2 grid gap-2">
              {state.rewrittenQueries.map((q, i) => (
                <li key={i} className="rounded-md bg-surface-sunk px-3 py-2 font-mono text-sm text-ink break-words">
                  <span className="mr-2 text-ink-muted">#{i + 1}</span>{q}
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <ul className="mt-5 grid gap-1.5 text-sm">
          {degraded ? (
            <li className="rounded-md bg-warning-soft px-3 py-2 font-semibold text-warning">
              搜索引擎降级：{degraded.from} → {degraded.to}
            </li>
          ) : null}
          {state.cacheHit ? (
            <li className="rounded-md bg-accent-soft px-3 py-2 font-semibold text-accent-soft-ink">本次为缓存回放</li>
          ) : null}
          {state.done ? (
            <li className="text-ink-muted">
              实际引擎：{state.done.enginesUsed.join("、")} · 信源 {state.done.sourceCount} 个 · 正文 {state.done.charCount} 字符
            </li>
          ) : null}
        </ul>
      </div>

      {/* 右：信源分数雷达 */}
      <div className="rounded-card bg-surface px-6 py-7 shadow-e2 lg:col-span-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-lg font-bold">信源与分数</h2>
          <p className="font-mono text-sm tabular-nums text-ink-soft">{state.sources.length} 个</p>
        </div>
        <ul className="mt-2">
          {state.sources.map((source) => (
            <SourceRow key={source.id} source={source} onLocate={onLocateSource} categoryLabel={categoryLabel} />
          ))}
        </ul>
        {state.sources.length === 0 ? (
          <p className="py-6 text-ui text-ink-soft">本次没有可展示的信源。</p>
        ) : null}
      </div>
    </section>
  );
}
