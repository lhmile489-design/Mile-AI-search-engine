import type { Citation } from "@/types";

// 证据高亮：highlight.start/end 是 passage 的 UTF-16 码元偏移（契约 §7.2），
// 与 JS 字符串下标同一单位，直接 slice，不能转成码点数组再切。

export type PassageSegment = Readonly<{ text: string; marked: boolean }>;
export type Range = Readonly<{ start: number; end: number }>;

/**
 * 找出「被点击的那个角标」对应的高亮区间：index 相同且 markerStart 相同的那一条 citation。
 * 同一信源下的其他句子不高亮。markerStart 为 null（识别不出偏移）、citations 里没有对应条目、
 * highlight 为 null 时返回空数组，调用方只高亮卡片。区间裁剪到 [0, length]，空区间丢弃。
 */
export function rangeForMarker(
  citations: ReadonlyArray<Citation>,
  index: number,
  markerStart: number | null,
  length: number,
): ReadonlyArray<Range> {
  if (markerStart === null) return [];
  const hit = citations.find((c) => c.index === index && c.markerStart === markerStart);
  if (!hit?.highlight) return [];
  const start = Math.max(0, Math.min(hit.highlight.start, length));
  const end = Math.max(0, Math.min(hit.highlight.end, length));
  return end > start ? [{ start, end }] : [];
}

/** 把 passage 按区间切成 [普通, 高亮, 普通, ...]；没有区间时返回单段普通文本。 */
export function splitPassage(passage: string, ranges: ReadonlyArray<Range>): ReadonlyArray<PassageSegment> {
  if (ranges.length === 0) return [{ text: passage, marked: false }];
  const segments: PassageSegment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) segments.push({ text: passage.slice(cursor, range.start), marked: false });
    segments.push({ text: passage.slice(range.start, range.end), marked: true });
    cursor = range.end;
  }
  if (cursor < passage.length) segments.push({ text: passage.slice(cursor), marked: false });
  return segments;
}
