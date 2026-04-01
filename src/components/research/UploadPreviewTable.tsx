/**
 * UploadPreviewTable
 * Sortable, filterable preview of the first 50 rows of an uploaded dataset.
 * Column headers show inferred type badges and PII warnings.
 */

import { useState, useMemo } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ColumnMeta } from "@/hooks/useResearchUploads";

const TYPE_COLORS: Record<string, string> = {
  number:     "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  currency:   "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  percentage: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  date:       "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  boolean:    "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  string:     "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
};

interface UploadPreviewTableProps {
  columns: ColumnMeta[];
  rows: Record<string, any>[];
  className?: string;
}

export function UploadPreviewTable({ columns, rows, className }: UploadPreviewTableProps) {
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filterText, setFilterText] = useState("");

  const filteredRows = useMemo(() => {
    if (!filterText.trim()) return rows;
    const lower = filterText.toLowerCase();
    return rows.filter((row) =>
      Object.values(row).some((v) => v != null && String(v).toLowerCase().includes(lower))
    );
  }, [rows, filterText]);

  const sortedRows = useMemo(() => {
    if (!sortCol) return filteredRows;
    return [...filteredRows].sort((a, b) => {
      const av = a[sortCol];
      const bv = b[sortCol];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filteredRows, sortCol, sortDir]);

  function toggleSort(col: string) {
    if (sortCol === col) {
      setSortDir((d) => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  function formatCell(value: any, col: ColumnMeta): string {
    if (value == null) return "—";
    const type = col.userOverrideType || col.inferredType;
    if (type === "currency") return typeof value === "number" ? `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : String(value);
    if (type === "percentage") return typeof value === "number" ? `${value.toFixed(2)}%` : String(value);
    if (type === "boolean") return value ? "Yes" : "No";
    if (typeof value === "number") return value.toLocaleString();
    return String(value);
  }

  if (columns.length === 0) return null;

  return (
    <div className={cn("space-y-2", className)}>
      {/* Filter bar */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
        <input
          type="text"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Filter rows..."
          className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
        />
      </div>

      {/* Table */}
      <div className="overflow-auto rounded-xl border border-slate-200 dark:border-slate-700 max-h-[400px]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800/80 backdrop-blur">
            <tr>
              {columns.map((col) => {
                const activeType = col.userOverrideType || col.inferredType;
                const isSorted = sortCol === col.name;
                return (
                  <th
                    key={col.name}
                    className="px-3 py-2 text-left font-medium whitespace-nowrap border-b border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
                    onClick={() => toggleSort(col.name)}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-700 dark:text-slate-200">{col.displayName}</span>
                      <span className={cn("text-[9px] px-1 py-0.5 rounded font-medium", TYPE_COLORS[activeType])}>
                        {activeType}
                      </span>
                      {col.isPotentialPii && (
                        <AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0" title="May contain PII" />
                      )}
                      {isSorted
                        ? sortDir === "asc"
                          ? <ArrowUp className="w-3 h-3 text-emerald-500" />
                          : <ArrowDown className="w-3 h-3 text-emerald-500" />
                        : <ArrowUpDown className="w-3 h-3 text-slate-300 dark:text-slate-600" />
                      }
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                className={cn(
                  "border-b border-slate-100 dark:border-slate-800 last:border-0",
                  rowIdx % 2 === 0 ? "bg-white dark:bg-slate-900" : "bg-slate-50/40 dark:bg-slate-800/30"
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.name}
                    className="px-3 py-1.5 text-slate-600 dark:text-slate-400 max-w-[200px] truncate"
                    title={row[col.name] != null ? String(row[col.name]) : undefined}
                  >
                    {formatCell(row[col.name], col)}
                  </td>
                ))}
              </tr>
            ))}
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-slate-400 dark:text-slate-500">
                  No rows match your filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400 dark:text-slate-500 text-right">
        Showing {sortedRows.length} of {rows.length} preview rows
      </p>
    </div>
  );
}
