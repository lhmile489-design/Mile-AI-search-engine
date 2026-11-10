const NUMBER = new Intl.NumberFormat("en-US");

/**
 * 数字带单位：1,284 ms（PRODUCT.md §8）。
 * 后端按整毫秒下发，缓存回放常测得 0；0 表示实测不足 1 ms，不是没有测量，
 * 所以显示「小于 1 ms」，不改写测量值。
 */
export function formatMs(ms: number): string {
  if (ms < 1) return "小于 1 ms";
  return `${NUMBER.format(ms)} ms`;
}

export function formatCount(count: number, unit: string): string {
  return `${NUMBER.format(count)} ${unit}`;
}

/** ISO 8601 -> 本地日期（YYYY-MM-DD）；无法解析返回 null，调用方不显示 */
export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  return new Date(time).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/** 历史条目时间：本地 月-日 时:分 */
export function formatDateTime(iso: string): string | null {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  return new Date(time).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
