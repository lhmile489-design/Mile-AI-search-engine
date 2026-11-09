"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { CitationText } from "./CitationText";
import type { CardTextProps } from "./types";

// HardwareBenchmarkCard 的渲染：可排序表格卡片。
// 列可排序时点击表头切换升/降序；单元格 [n] 渲染为角标按钮。
// DSL 里 cells 的值统一 String()（签名草案 §5：单元格写成数字也不报错）。

export type ColumnDef = Readonly<{
  key: string;
  label: string;
  sortable?: boolean;
  highlight?: boolean;
}>;

export type RowData = Readonly<{
  cells: Record<string, string>;
}>;

export type BenchmarkCardViewProps = CardTextProps &
  Readonly<{
    title: string;
    columns: ReadonlyArray<ColumnDef>;
    rows: ReadonlyArray<RowData>;
    note?: string;
  }>;

type SortDir = "asc" | "desc";

function cellNumber(cell: string): number | null {
  // 排序按单元格开头的数字，先去掉 [n] 角标
  const stripped = cell.replace(/\[\d+\]/g, "").trim();
  const num = parseFloat(stripped);
  return Number.isFinite(num) ? num : null;
}

export function BenchmarkCardView({ title, columns, rows, note, onCite, maxCitation }: BenchmarkCardViewProps) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sorted = [...rows].sort((a, b) => {
    if (!sortKey) return 0;
    const av = cellNumber(String(a.cells[sortKey] ?? ""));
    const bv = cellNumber(String(b.cells[sortKey] ?? ""));
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return sortDir === "asc" ? av - bv : bv - av;
  });

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  return (
    <div className="rounded-card bg-surface px-6 py-5 shadow-e2">
      <h3 className="font-display text-lg font-bold text-ink">
        <CitationText text={title} maxCitation={maxCitation} onCite={onCite} />
      </h3>
      <div className="table-wrap mt-4">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {columns.map((col) => {
                const active = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    className={cn(
                      "border-b border-line px-3 py-2 text-left text-label font-semibold",
                      col.highlight ? "text-accent-deep" : "text-ink-soft",
                    )}
                  >
                    {col.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className="inline-flex cursor-pointer items-center gap-1 hover:text-ink"
                        aria-label={`按 ${col.label} 排序`}
                      >
                        {col.label}
                        {active ? (
                          sortDir === "asc" ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />
                        ) : (
                          <ArrowUpDown size={14} aria-hidden="true" className="opacity-50" />
                        )}
                      </button>
                    ) : (
                      col.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={i} className="border-b border-line last:border-b-0">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      "px-3 py-2.5 text-ui",
                      col.highlight ? "font-semibold text-ink" : "text-ink-soft",
                    )}
                  >
                    <CitationText text={String(row.cells[col.key] ?? "")} maxCitation={maxCitation} onCite={onCite} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note ? (
        <p className="mt-3 text-sm text-ink-muted">
          <CitationText text={note} maxCitation={maxCitation} onCite={onCite} />
        </p>
      ) : null}
    </div>
  );
}
