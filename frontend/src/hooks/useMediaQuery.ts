"use client";

import { useSyncExternalStore } from "react";

/** 订阅 CSS 媒体查询。服务端和首次水合按 false 渲染，避免水合不一致。 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
