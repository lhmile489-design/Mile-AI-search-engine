import type {
  AppConfig,
  HistoryDetail,
  HistoryList,
  SuggestionsData,
} from "@/types";
import { resolveTransport } from "./transport";

// 非流式接口：统一走 SearchTransport（契约 §13）。
// mock 与真实现在 transport.ts 的 resolveTransport 一处切换，这里不再感知来源。

export const getConfig = (_signal?: AbortSignal): Promise<AppConfig> =>
  resolveTransport().then((t) => t.getConfig());

export const getSuggestions = (_signal?: AbortSignal): Promise<SuggestionsData> =>
  resolveTransport().then((t) => t.getSuggestions());

export const getHistoryList = (page = 1, pageSize = 20, _signal?: AbortSignal): Promise<HistoryList> =>
  resolveTransport().then((t) => t.listHistory(page, pageSize, ""));

export const getHistoryDetail = (id: string, _signal?: AbortSignal): Promise<HistoryDetail> =>
  resolveTransport().then((t) => t.getHistory(id));

export const deleteHistory = (id: string): Promise<{ deleted: boolean }> =>
  resolveTransport().then((t) => t.deleteHistory(id));

export const saveSettings = (s: { llmApiKey?: string; tavilyApiKey?: string }): Promise<void> =>
  resolveTransport().then((t) => t.saveSettings(s));
