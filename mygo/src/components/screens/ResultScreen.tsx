
import { useState, type RefObject } from "react";
import { Activity, Check, Copy, Download, FileText, PanelRight, RefreshCw, Square } from "lucide-react";
import logoUrl from "@/assets/appLogo.png";
import { cn } from "@/lib/cn";
import { formatMs } from "@/lib/format";
import { ConsensusBadge } from "@/components/search/ConsensusBadge";
import { EvidenceDrawer } from "@/components/search/EvidenceDrawer";
import { ObservationDeck } from "@/components/search/ObservationDeck";
import { RelatedQuestions } from "@/components/search/RelatedQuestions";
import { ReportView } from "@/components/search/ReportView";
import { StageSummaryBar } from "@/components/search/StageSummaryBar";
import { Superbar } from "@/components/search/Superbar";
import { TakeawayCard } from "@/components/search/TakeawayCard";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { isReplayingCache, type SearchState } from "@/store/state";
import type { AppConfig, FocusMode, SourceCategory } from "@/types";

// 屏幕 3：研报与证据工作台（PRODUCT.md §4.3），布局对齐 docs/ui-redesign-preview.html：
//   吸顶视角条 .tab-strip（研报 / 观测台，右侧信源数 · 耗时、共识度、新检索）
//   左 .conv-panel：用户问题气泡 + AI 回复（检索过程折叠块、要点、研报、相关追问）+ 底部输入栏
//   右 .preview-panel：信源与证据；小于 1024px 时改为右侧滑出的覆盖式抽屉
// 所有数字来自后端事件与快照，不写示例值。

export type ResultScreenProps = Readonly<{
  state: SearchState;
  onDraftChange: (value: string) => void;
  onSubmit: (query?: string) => void;
  onStop: () => void;
  onNewSearch: () => void;
  onCite: (index: number, markerStart: number | null) => void;
  onOpenDrawer: () => void;
  onCloseDrawer: () => void;
  onFocusSource: (index: number) => void;
  onClearCitation: () => void;
  categoryLabel: (category: string) => string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  blockedReason: string | null;
  config: AppConfig | null;
  onFocusModeChange: (mode: FocusMode) => void;
  onScopeFiltersChange: (next: ReadonlyArray<SourceCategory>) => void;
  onEngineChange: (engine: string) => void;
}>;

type ViewTab = "report" | "observatory";
type CopyState = "idle" | "copied" | "failed";

async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function ResultScreen({
  state,
  onDraftChange,
  onSubmit,
  onStop,
  onNewSearch,
  onCite,
  onOpenDrawer,
  onCloseDrawer,
  onFocusSource,
  onClearCitation,
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
  const [reportCopy, setReportCopy] = useState<CopyState>("idle");
  const [bibCopy, setBibCopy] = useState<CopyState>("idle");
  const { sources, generating, aborted, latencyMs } = state;
  const cacheHit = state.cacheHit || isReplayingCache(state.steps);

  // F13：导出全部 preprint 信源的 BibTeX；没有任何 bibtex 时按钮停用
  const bibtexAll = sources
    .map((s) => s.bibtex)
    .filter((b): b is string => typeof b === "string" && b.length > 0)
    .join("\n\n");

  const flash = (set: (v: CopyState) => void, ok: boolean) => {
    set(ok ? "copied" : "failed");
    window.setTimeout(() => set("idle"), 2000);
  };

  const dotClass = generating ? "is-live" : aborted ? "is-warn" : "";

  return (
    <section aria-label="研报与证据" className="w-full">
      {/* 吸顶视角条（.tab-strip） */}
      <div className="tab-strip" role="tablist" aria-label="结果视角">
        {(
          [
            { id: "report", label: "研报", Icon: FileText },
            { id: "observatory", label: "观测台", Icon: Activity },
          ] as const
        ).map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            onClick={() => setView(id)}
            className="tab-item"
          >
            <Icon size={14} aria-hidden="true" />
            {label}
          </button>
        ))}
        <div className="flex-1" />
        <div className="mr-2 flex items-center gap-3">
          <span className="hidden whitespace-nowrap text-sm text-ink-muted md:inline">
            <span className="font-mono tabular-nums">{sources.length}</span> 个信源
            {latencyMs !== null ? (
              <>
                {" · "}
                <span className="font-mono tabular-nums">{formatMs(latencyMs)}</span>
              </>
            ) : null}
          </span>
          <ConsensusBadge consensus={state.consensus} />
        </div>
        <button
          type="button"
          aria-controls="evidence-drawer"
          aria-expanded={state.drawerOpen}
          onClick={onOpenDrawer}
          className="btn-sm lg:hidden"
        >
          <PanelRight size={13} aria-hidden="true" />
          证据 {sources.length}
        </button>
        {generating ? (
          <button type="button" onClick={onStop} className="btn-sm">
            <Square size={13} aria-hidden="true" />
            停止生成
          </button>
        ) : null}
        <button type="button" onClick={onNewSearch} className="btn-sm">
          <RefreshCw size={13} aria-hidden="true" />
          新检索
        </button>
      </div>

      {view === "observatory" ? (
        <div className="p-6">
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
        <div className="content-area">
          {/* 左：研报对话面板（.conv-panel） */}
          <div className="conv-panel">
            <div className="conv-panel-header">
              <h2 className="conv-panel-title">
                <span className={cn("conv-panel-title-dot", dotClass)} aria-hidden="true" />
                研报内容
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={reportCopy === "copied" ? "已复制研报" : "复制研报"}
                  title={reportCopy === "failed" ? "无法访问剪贴板" : "复制研报"}
                  disabled={!state.report}
                  onClick={async () => flash(setReportCopy, await copyText(state.report))}
                  className="icon-btn"
                >
                  {reportCopy === "copied" ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  aria-label={bibCopy === "copied" ? "已复制全部 BibTeX" : "复制全部 BibTeX"}
                  title={bibtexAll ? (bibCopy === "failed" ? "无法访问剪贴板" : "复制全部 BibTeX") : "本次没有提供 BibTeX 的信源"}
                  disabled={!bibtexAll}
                  onClick={async () => flash(setBibCopy, await copyText(bibtexAll))}
                  className="icon-btn"
                >
                  {bibCopy === "copied" ? <Check size={16} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
                </button>
              </div>
            </div>

            <div className="conv-messages">
              <div className="msg-user">
                <div className="msg-user-bubble">{state.query}</div>
              </div>

              <div className="msg-ai">
                <img src={logoUrl} alt="" className="msg-ai-avatar" />
                <div className="msg-ai-content">
                  <div className="msg-ai-meta">
                    <span className="msg-ai-name">Mile AI</span>
                    {generating ? (
                      <span className="msg-ai-time">生成中</span>
                    ) : aborted ? (
                      <span className="msg-ai-time">已中止</span>
                    ) : null}
                    <span className="msg-ai-badge">{sources.length} 个信源</span>
                    {cacheHit ? <span className="msg-ai-badge is-accent">缓存命中</span> : null}
                    {state.restoredFromHistory ? <span className="msg-ai-time">来自历史记录</span> : null}
                  </div>

                  {/* F24：检索过程折叠块 */}
                  <StageSummaryBar state={state} />

                  <div className="msg-ai-bubble">
                    <TakeawayCard
                      takeaways={state.takeaways}
                      maxCitation={sources.length}
                      onCite={(index) => onCite(index, null)}
                    />
                    <ReportView
                      report={state.report}
                      generating={generating}
                      aborted={aborted}
                      maxCitation={sources.length}
                      activeCitation={state.activeCitation}
                      onCite={onCite}
                      onClear={onClearCitation}
                    />
                  </div>

                  <RelatedQuestions items={state.related} onSelect={(q) => onSubmit(q)} />
                </div>
              </div>
            </div>

            {/* 底部输入栏（.input-bar） */}
            <div className="input-bar">
              <Superbar
                compact
                value={state.draft}
                onChange={onDraftChange}
                onSubmit={() => onSubmit()}
                inputRef={inputRef}
                label="输入新的技术问题"
                blockedReason={blockedReason}
                placeholder="继续追问，或输入新的技术问题"
                config={config}
                focusMode={state.focusMode}
                scopeFilters={state.scopeFilters}
                engine={state.engine}
                onFocusModeChange={onFocusModeChange}
                onScopeFiltersChange={onScopeFiltersChange}
                onEngineChange={onEngineChange}
              />
            </div>
          </div>

          {/* 右：信源与证据（.preview-panel） */}
          <div className="min-w-0">
            <EvidenceDrawer
              sources={sources}
              citations={state.citations}
              activeCitation={state.activeCitation}
              open={state.drawerOpen}
              desktop={desktop}
              onClose={onCloseDrawer}
              onFocusSource={onFocusSource}
              categoryLabel={categoryLabel}
            />
          </div>
        </div>
      )}
    </section>
  );
}
