import type { Citation } from "@/types";

// 证据高亮：highlight.start/end 是 passage 的 UTF-16 码元偏移（契约 §7.2），
// 与 JS 字符串下标同一单位，直接 slice，不能转成码点数组再切。

export type PassageSegment = Readonly<{ text: string; marked: boolean }>;
export type Range = Readonly<{ start: number; end: number }>;

/** 取出被引用编号 index 的全部高亮区间，裁剪到 [0, length]，丢弃空区间，合并重叠区间。 */
export function collectRanges(
  citations: ReadonlyArray<Citation>,
  index: number,
  length: number,
): ReadonlyArray<Range> {
  const raw: Range[] = [];
  for (const citation of citations) {
    if (citation.index !== index || !citation.highlight) continue;
    const start = Math.max(0, Math.min(citation.highlight.start, length));
    const end = Math.max(0, Math.min(citation.highlight.end, length));
    if (end > start) raw.push({ start, end });
  }
  raw.sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  for (const range of raw) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, range.end) };
    } else {
      merged.push(range);
    }
  }
  return merged;
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
