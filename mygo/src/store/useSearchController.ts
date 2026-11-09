
import { useCallback, useEffect, useRef } from "react";
import { getHistoryDetail } from "@/lib/api";
import { ApiError } from "@/lib/http";
import type { StreamHandle } from "@/lib/transport";
import { resolveOpenStream } from "@/lib/transport";
import { useBootData, type BootData } from "@/hooks/useBootData";
import type { FocusMode, SearchRequest, SourceCategory } from "@/types";
import type { UiError, SearchState } from "./state";
import type { SearchAction } from "./actions";
import { escapeAction } from "./reducer";
import { useSearchStore } from "./useSearchStore";

// 控制器：把「网络 IO」和「纯 reducer」接起来。
// 组件只拿到 state 和一组命令（submit / abort / restore ...），不接触 fetch、不接触流。

export const MAX_QUERY_LENGTH = 500;

/** 契约：去首尾空白后 1–500 字符，后端按 Unicode 码点计，这里同样按码点数。 */
export function queryLength(text: string): number {
  return Array.from(text.trim()).length;
}

export type SearchController = Readonly<{
  state: SearchState;
  boot: BootData;
  dispatch: (action: SearchAction) => void;
  setDraft: (draft: string) => void;
  submit: (query?: string) => Promise<void>;
  retry: () => Promise<void>;
  abort: () => void;
  newSearch: () => void;
  restore: (id: string) => Promise<void>;
  /** Esc：检索中 / 生成中停止；结果页已完成时关闭覆盖式抽屉。返回是否处理了按键。 */
  handleEscape: () => boolean;
  setFocusMode: (focusMode: FocusMode) => void;
  setScopeFilters: (scopeFilters: ReadonlyArray<SourceCategory>) => void;
  setEngine: (engine: string) => void;
}>;

function showError(dispatch: (action: SearchAction) => void, title: string, hint: string, retryable = false): void {
  const error: UiError = { title, hint, retryable, code: null, step: null };
  dispatch({ type: "SHOW_ERROR", error });
}

export function useSearchController(): SearchController {
  const { state, dispatch, getState } = useSearchStore();
  const boot = useBootData();
  const bootRef = useRef(boot);
  bootRef.current = boot;
  const handleRef = useRef<StreamHandle | null>(null);
  const restoreSeq = useRef(0);

  const stopStream = useCallback(() => {
    handleRef.current?.abort();
    handleRef.current = null;
  }, []);

  // 卸载时释放连接
  useEffect(() => stopStream, [stopStream]);

  const startRun = useCallback(
    async (request: SearchRequest) => {
      const runId = getState().runId;
      // token 合并：每帧最多派发一次，避免每个 delta 触发一次整篇 Markdown 重渲染
      let pending = "";
      let frame: number | null = null;
      const flush = () => {
        if (frame !== null) {
          cancelAnimationFrame(frame);
          frame = null;
        }
        if (pending) {
          const delta = pending;
          pending = "";
          dispatch({ type: "STREAM_EVENT", runId, event: { type: "token", data: { delta } } });
        }
      };

      const openStream = await resolveOpenStream();
      if (getState().runId !== runId) return; // 等待期间已被中止或被新检索取代

      const handle = openStream(request, {
        onEvent: (event) => {
          if (event.type === "token") {
            pending += event.data.delta;
            if (frame === null) {
              frame = requestAnimationFrame(() => {
                frame = null;
                flush();
              });
            }
            return;
          }
          flush(); // 保持 token 与其他事件的先后顺序
          dispatch({ type: "STREAM_EVENT", runId, event });
        },
        onFailure: (failure) => {
          flush();
          dispatch({ type: "STREAM_FAILURE", runId, failure });
        },
        onClose: () => {
          flush();
          dispatch({ type: "STREAM_CLOSED", runId });
        },
      });
      handleRef.current = {
        abort: () => {
          flush(); // 中止前先把已缓冲的正文落进 store，保证「保留已生成内容」
          handle.abort();
        },
      };
    },
    [dispatch, getState],
  );

  const submit = useCallback(
    async (raw?: string) => {
      const query = (raw ?? getState().draft).trim();
      const length = queryLength(query);
      if (length < 1 || length > MAX_QUERY_LENGTH) return;

      // F22：优先用用户在 Superbar 里选的引擎；没选过就从 /api/config 取第一个可用
      let engine = getState().engine ?? bootRef.current.engine;
      if (!engine) {
        const config = await bootRef.current.reloadConfig();
        if (!config) {
          // 连配置都拿不到：透出真实原因（G3 前是「未实现」），不是笼统的连接失败
          const reason = bootRef.current.configError;
          showError(
            dispatch,
            reason ?? "检索服务连接失败",
            reason
              ? "请确认 Go 侧已实现该接口，然后点击「重试」。"
              : "请检查网络，并确认后端服务已启动，然后点击「重试」。",
            true,
          );
          return;
        }
        engine = config.engines.find((item) => item.available)?.value ?? null;
      }
      if (!engine) {
        showError(
          dispatch,
          "没有可用的检索引擎",
          "请确认后端服务已启动，且 backend/.env 中至少配置了一个搜索引擎的密钥，然后重试。",
          true,
        );
        return;
      }

      // F15 / F21：沿用用户当前选择，不写死
      const { focusMode, scopeFilters } = getState();
      stopStream(); // 同一时刻最多一个检索：先中止旧连接
      dispatch({ type: "SUBMIT", query });
      await startRun({ query, focusMode, engine, scopeFilters: [...scopeFilters] });
    },
    [dispatch, getState, startRun, stopStream],
  );

  const retry = useCallback(async () => {
    const query = getState().query;
    if (query) await submit(query);
  }, [getState, submit]);

  const abort = useCallback(() => {
    stopStream();
    dispatch({ type: "ABORT" });
  }, [dispatch, stopStream]);

  const newSearch = useCallback(() => {
    stopStream();
    dispatch({ type: "NEW_SEARCH" });
  }, [dispatch, stopStream]);

  const restore = useCallback(
    async (id: string) => {
      const seq = (restoreSeq.current += 1);
      try {
        const detail = await getHistoryDetail(id);
        if (seq !== restoreSeq.current) return; // 连续点击时只认最后一次
        stopStream();
        dispatch({ type: "RESTORE", detail });
      } catch (error) {
        if (seq !== restoreSeq.current) return;
        const notFound = error instanceof ApiError && error.code === 40401;
        showError(
          dispatch,
          notFound ? "这条历史记录已不存在" : "读取历史记录失败",
          notFound ? "列表将自动刷新。" : "请确认后端服务已启动后重试。",
        );
        if (notFound) dispatch({ type: "HISTORY_CHANGED" });
      }
    },
    [dispatch, stopStream],
  );

  const handleEscape = useCallback((): boolean => {
    const action = escapeAction(getState());
    if (action === "abort") abort();
    else if (action === "close-drawer") dispatch({ type: "CLOSE_DRAWER" });
    return action !== "none";
  }, [abort, dispatch, getState]);

  const setDraft = useCallback((draft: string) => dispatch({ type: "DRAFT_CHANGED", draft }), [dispatch]);
  const setFocusMode = useCallback(
    (focusMode: FocusMode) => dispatch({ type: "SET_FOCUS_MODE", focusMode }),
    [dispatch],
  );
  const setScopeFilters = useCallback(
    (scopeFilters: ReadonlyArray<SourceCategory>) => dispatch({ type: "SET_SCOPE_FILTERS", scopeFilters }),
    [dispatch],
  );
  const setEngine = useCallback((engine: string) => dispatch({ type: "SET_ENGINE", engine }), [dispatch]);

  return { state, boot, dispatch, setDraft, submit, retry, abort, newSearch, restore, handleEscape, setFocusMode, setScopeFilters, setEngine };
}
