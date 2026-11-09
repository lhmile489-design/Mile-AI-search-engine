"use client";

import { useState, type RefObject } from "react";
import { Activity, FileText, PanelRight, Plus, Square } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConsensusBadge } from "@/components/search/ConsensusBadge";
import { EvidenceDrawer } from "@/components/search/EvidenceDrawer";
import { ObservationDeck } from "@/components/search/ObservationDeck";
import { RelatedQuestions } from "@/components/search/RelatedQuestions";
import { ReportView } from "@/components/search/ReportView";
import { ResultToolbar } from "@/components/search/ResultToolbar";
import { StageSummaryBar } from "@/components/search/StageSummaryBar";
import { Superbar } from "@/components/search/Superbar";
import { TakeawayCard } from "@/components/search/TakeawayCard";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { isReplayingCache, type SearchState } from "@/store/state";
import type { AppConfig, FocusMode, SourceCategory } from "@/types";

// 屏幕 3：研报与证据工作台（PRODUCT.md §4.3）。左 60% 研报，右 40% 证据抽屉；
// 小于 1024px 时抽屉改为右侧滑出的覆盖式抽屉。
// F12 观测台是结果页的第二个视角，与「研报」视角切换。

export type ResultScreenProps = Readonly<{
  state: SearchState;
  onDraftChange: (value: string) => void;
  onSubmit: (query?: string) => void;
  onStop: () => void;
  onNewSearch: () => void;
  onCite: (index: number, markerStart: number | null) => void;
  onOpenDrawer: () => void;
  onCloseDrawer: () => void;
  categoryLabel: (category: string) => string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  blockedReason: string | null;
  config: AppConfig | null;
  onFocusModeChange: (mode: FocusMode) => void;
  onScopeFiltersChange: (next: ReadonlyArray<SourceCategory>) => void;
  onEngineChange: (engine: string) => void;
}>;

type ViewTab = "report" | "observatory";

export function ResultScreen({
  state,
  onDraftChange,
  onSubmit,
  onStop,
  onNewSearch,
  onCite,
  onOpenDrawer,
  onCloseDrawer,
  categoryLabel,
  inputRef,
  blockedReason,
  config,
  onFocusModeChange,
  onScopeFiltersChange,
  onEngineChange,
}: ResultScreenProps) {
  const desktop = useMediaQuery("(min-width: 1024px)");
  const [view, setView] = useState<ViewTab>("report");
  const { sources, generating, aborted, latencyMs } = state;

  return (
    <section aria-label="研报与证据" className="mx-auto w-full max-w-workbench px-5 pb-16 pt-8">
      <ResultToolbar
        query={state.query}
        generating={generating}
        aborted={aborted}
        latencyMs={latencyMs}
        sourceCount={sources.length}
        cacheHit={state.cacheHit || isReplayingCache(state.steps)}
        restoredFromHistory={state.restoredFromHistory}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <ConsensusBadge consensus={state.consensus} />
            <span className="lg:hidden">
              <Button
                variant="secondary"
                icon={PanelRight}
                aria-controls="evidence-drawer"
                aria-expanded={state.drawerOpen}
                onClick={onOpenDrawer}
              >
                {`证据 ${sources.length}`}
              </Button>
            </span>
            {generating ? (
              <Button variant="secondary" icon={Square} onClick={onStop}>
                停止生成
              </Button>
            ) : null}
            <Button variant="secondary" icon={Plus} onClick={onNewSearch}>
              新检索
            </Button>
          </div>
        }
      />

      <div className="mt-4">
        <Superbar
          compact
          value={state.draft}
          onChange={onDraftChange}
          onSubmit={() => onSubmit()}
          inputRef={inputRef}
          label="输入新的技术问题"
          blockedReason={blockedReason}
          placeholder="继续提问，或输入新的技术问题"
          config={config}
          focusMode={state.focusMode}
          scopeFilters={state.scopeFilters}
          engine={state.engine}
          onFocusModeChange={onFocusModeChange}
          onScopeFiltersChange={onScopeFiltersChange}
          onEngineChange={onEngineChange}
        />
      </div>

      {/* F24：推理摘要折叠条 */}
      <div className="mt-4">
        <StageSummaryBar state={state} />
      </div>

      {/* F12：视角切换 */}
      <div className="mt-6 flex items-center gap-1" role="tablist" aria-label="结果视角">
        <button
          type="button"
          role="tab"
          aria-selected={view === "report"}
          onClick={() => setView("report")}
          className={
            view === "report"
              ? "inline-flex cursor-pointer items-center gap-2 rounded-pill bg-accent-soft px-4 py-2 text-label font-semibold text-accent-soft-ink shadow-e1"
              : "inline-flex cursor-pointer items-center gap-2 rounded-pill px-4 py-2 text-label font-semibold text-ink-muted transition-colors duration-fast hover:text-ink"
          }
        >
          <FileText size={16} aria-hidden="true" />
          研报
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "observatory"}
          onClick={() => setView("observatory")}
          className={
            view === "observatory"
              ? "inline-flex cursor-pointer items-center gap-2 rounded-pill bg-accent-soft px-4 py-2 text-label font-semibold text-accent-soft-ink shadow-e1"
              : "inline-flex cursor-pointer items-center gap-2 rounded-pill px-4 py-2 text-label font-semibold text-ink-muted transition-colors duration-fast hover:text-ink"
          }
        >
          <Activity size={16} aria-hidden="true" />
          观测台
        </button>
      </div>

      {view === "observatory" ? (
        <div className="mt-6">
          <ObservationDeck
            state={state}
            categoryLabel={categoryLabel}
            onLocateSource={(index) => {
              setView("report");
              onCite(index, null);
            }}
          />
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-5 lg:items-start">
          <div className="min-w-0 lg:col-span-3">
            <TakeawayCard takeaways={state.takeaways} maxCitation={sources.length} onCite={(index) => onCite(index, null)} />
            {state.takeaways && state.takeaways.length > 0 ? <div className="h-6" /> : null}
            <ReportView
              report={state.report}
              generating={generating}
              aborted={aborted}
              maxCitation={sources.length}
              activeCitation={state.activeCitation}
              onCite={onCite}
            />
            <div className="mt-6">
              <RelatedQuestions items={state.related} onSelect={(q) => onSubmit(q)} />
            </div>
          </div>
          <div className="min-w-0 lg:col-span-2">
            <EvidenceDrawer
              sources={sources}
              citations={state.citations}
              activeCitation={state.activeCitation}
              open={state.drawerOpen}
              desktop={desktop}
              onClose={onCloseDrawer}
              categoryLabel={categoryLabel}
            />
          </div>
        </div>
      )}
    </section>
  );
}
