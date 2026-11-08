"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ErrorBanner } from "@/components/layout/ErrorBanner";
import { HistorySidebar } from "@/components/layout/HistorySidebar";
import { TopBar } from "@/components/layout/TopBar";
import { CommandScreen } from "@/components/screens/CommandScreen";
import { ResultScreen } from "@/components/screens/ResultScreen";
import { RetrievalScreen } from "@/components/screens/RetrievalScreen";
import { useHistory } from "@/hooks/useHistory";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/cn";
import { useSearchController } from "@/store/useSearchController";

// 应用外壳：把控制器、三个屏幕、历史侧边栏和全局快捷键接在一起。
// 这里只做装配，不含业务状态：所有三态流转都在 store/reducer.ts。

export function SearchApp() {
  const controller = useSearchController();
  const { state, boot, dispatch } = controller;
  const history = useHistory(state.historyVersion);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const desktop = useMediaQuery("(min-width: 1024px)");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const toggleSidebar = useCallback(() => setSidebarOpen((open) => !open), []);

  // 全局快捷键（PRODUCT.md §6）：Ctrl/Cmd+K、Ctrl/Cmd+B、Esc 在输入框内也生效，并 preventDefault
  const { handleEscape } = controller;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && !event.altKey && !event.shiftKey && key === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      } else if (mod && !event.altKey && !event.shiftKey && key === "b") {
        event.preventDefault();
        toggleSidebar();
      } else if (event.key === "Escape" && !event.isComposing) {
        if (handleEscape()) event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleEscape, toggleSidebar]);

  const handleSelectHistory = useCallback(
    (id: string) => {
      if (!desktop) setSidebarOpen(false);
      void controller.restore(id);
    },
    [controller, desktop],
  );

  const handleDeleteHistory = useCallback(
    async (id: string) => {
      const ok = await history.remove(id);
      if (!ok) {
        dispatch({
          type: "SHOW_ERROR",
          error: {
            title: "删除历史记录失败",
            hint: "请确认后端服务已启动后重试。",
            retryable: false,
            code: null,
            step: null,
          },
        });
      }
    },
    [dispatch, history],
  );

  const handleCite = useCallback((index: number) => dispatch({ type: "OPEN_CITATION", index }), [dispatch]);
  const handleOpenDrawer = useCallback(() => dispatch({ type: "OPEN_DRAWER" }), [dispatch]);
  const handleCloseDrawer = useCallback(() => dispatch({ type: "CLOSE_DRAWER" }), [dispatch]);

  // 重试 = 用同一问题重新发起；还没有提交过（例如配置拉取失败）时按输入框内容提交
  const handleRetry = useCallback(() => {
    dispatch({ type: "DISMISS_ERROR" });
    void (state.query ? controller.retry() : controller.submit());
  }, [controller, dispatch, state.query]);

  return (
    <div className="min-h-screen">
      <TopBar sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} onHome={controller.newSearch} />
      <HistorySidebar
        open={sidebarOpen}
        onToggle={toggleSidebar}
        history={history}
        currentId={state.historyId}
        onSelect={handleSelectHistory}
        onDelete={(id) => void handleDeleteHistory(id)}
      />
      {state.error ? (
        <ErrorBanner error={state.error} onRetry={handleRetry} onDismiss={() => dispatch({ type: "DISMISS_ERROR" })} />
      ) : null}
      <main className={cn(sidebarOpen ? "lg:pl-sidebar" : "lg:pl-sidebar-compact")}>
        {state.phase === "initial" ? (
          <ErrorBoundary screen="首屏" onReset={controller.newSearch}>
            <CommandScreen
              draft={state.draft}
              onDraftChange={controller.setDraft}
              onSubmit={(query) => void controller.submit(query)}
              suggestions={boot.suggestions}
              inputRef={inputRef}
            />
          </ErrorBoundary>
        ) : null}
        {state.phase === "retrieving" ? (
          <ErrorBoundary screen="检索推理屏" onReset={controller.newSearch}>
            <RetrievalScreen state={state} onStop={controller.abort} categoryLabel={boot.categoryLabel} />
          </ErrorBoundary>
        ) : null}
        {state.phase === "result" ? (
          <ErrorBoundary screen="研报屏" onReset={controller.newSearch}>
            <ResultScreen
              state={state}
              onDraftChange={controller.setDraft}
              onSubmit={(query) => void controller.submit(query)}
              onStop={controller.abort}
              onNewSearch={controller.newSearch}
              onCite={handleCite}
              onOpenDrawer={handleOpenDrawer}
              onCloseDrawer={handleCloseDrawer}
              categoryLabel={boot.categoryLabel}
              inputRef={inputRef}
            />
          </ErrorBoundary>
        ) : null}
      </main>
    </div>
  );
}
