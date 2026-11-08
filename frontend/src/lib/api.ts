import type {
  AppConfig,
  HistoryDetail,
  HistoryList,
  SuggestionsData,
} from "@/types";
import { request } from "./http";

// 非流式接口的薄封装，路径与契约 §13 一一对应。

export const getConfig = (signal?: AbortSignal) => request<AppConfig>("/config", { signal });

export const getSuggestions = (signal?: AbortSignal) =>
  request<SuggestionsData>("/suggestions", { signal });

export const getHistoryList = (page = 1, pageSize = 20, signal?: AbortSignal) =>
  request<HistoryList>(`/history?page=${page}&pageSize=${pageSize}`, { signal });

export const getHistoryDetail = (id: string, signal?: AbortSignal) =>
  request<HistoryDetail>(`/history/${encodeURIComponent(id)}`, { signal });

export const deleteHistory = (id: string) =>
  request<{ deleted: boolean }>(`/history/${encodeURIComponent(id)}`, { method: "DELETE" });
