import type { FocusMode, HistoryDetail, SourceCategory, SseEvent } from "@/types";
import type { StreamFailure } from "@/lib/transport";
import type { UiError } from "./state";

// 组件只能派发这些动作，不能直接改状态（PRODUCT.md §3.2）。
// 带 runId 的动作来自流：发起时的 runId 与当前不一致就是迟到事件，reducer 直接丢弃。

export type SearchAction =
  | Readonly<{ type: "DRAFT_CHANGED"; draft: string }>
  | Readonly<{ type: "SUBMIT"; query: string }>
  | Readonly<{ type: "STREAM_EVENT"; runId: number; event: SseEvent }>
  | Readonly<{ type: "STREAM_FAILURE"; runId: number; failure: StreamFailure }>
  | Readonly<{ type: "STREAM_CLOSED"; runId: number }>
  | Readonly<{ type: "ABORT" }>
  | Readonly<{ type: "NEW_SEARCH" }>
  | Readonly<{ type: "RESTORE"; detail: HistoryDetail }>
  | Readonly<{ type: "OPEN_CITATION"; index: number; markerStart: number | null }>
  /** F06 反向定位：点信源卡片，正文里指向它的角标全部高亮；再点同一张卡片取消 */
  | Readonly<{ type: "FOCUS_SOURCE"; index: number }>
  | Readonly<{ type: "CLEAR_CITATION" }>
  | Readonly<{ type: "OPEN_DRAWER" }>
  | Readonly<{ type: "CLOSE_DRAWER" }>
  /** 非流式错误（配置拉取失败、历史恢复失败等）的提示条 */
  | Readonly<{ type: "SHOW_ERROR"; error: UiError }>
  | Readonly<{ type: "DISMISS_ERROR" }>
  | Readonly<{ type: "HISTORY_CHANGED" }>
  // F15 / F21 / F22：检索参数选择（state 持久，新检索 / 恢复历史时保留，方便「沿用当前设置再搜」）
  | Readonly<{ type: "SET_FOCUS_MODE"; focusMode: FocusMode }>
  | Readonly<{ type: "SET_SCOPE_FILTERS"; scopeFilters: ReadonlyArray<SourceCategory> }>
  | Readonly<{ type: "SET_ENGINE"; engine: string }>;
