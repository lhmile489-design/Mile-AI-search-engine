"use client";

import type { RefObject } from "react";
import { PanelRight, Plus, Square } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EvidenceDrawer } from "@/components/search/EvidenceDrawer";
import { ReportView } from "@/components/search/ReportView";
import { ResultToolbar } from "@/components/search/ResultToolbar";
import { Superbar } from "@/components/search/Superbar";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { isReplayingCache, type SearchState } from "@/store/state";

// 屏幕 3：研报与证据工作台（PRODUCT.md §4.3）。左 60% 研报，右 40% 证据抽屉；
// 小于 1024px 时抽屉改为右侧滑出的覆盖式抽屉。
// related / takeaways / consensus 的数据已在 store 里，M5 在这里留好的位置接入，本轮不渲染。

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
}>;

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
}: ResultScreenProps) {
  const desktop = useMediaQuery("(min-width: 1024px)");
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
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5 lg:items-start">
        <div className="min-w-0 lg:col-span-3">
          <ReportView
            report={state.report}
            generating={generating}
            aborted={aborted}
            maxCitation={sources.length}
            activeCitation={state.activeCitation}
            onCite={onCite}
          />
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
    </section>
  );
}
