/**
 * DataTable – sortable, dark-mode-aware table widget.
 *
 * Extracted from tier summary tables in CompanyScorecard and SalesScorecard.
 * Supports:
 * - Column-based sorting (click header to toggle)
 * - Sticky first column
 * - Column highlight tints (for tier columns)
 * - Responsive overflow
 * - Number formatting via KPIFormat
 */

import React, { useState, useMemo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { ArrowUp, ArrowDown } from 'lucide-react';
import type { WidgetRenderProps, TableData, TableColumn, KPIFormat } from '../registry/types';
import { formatKPIValue } from './KPICard';
import { WidgetShell } from './WidgetShell';

type SortDir = 'asc' | 'desc' | null;

function formatCell(value: unknown, format?: KPIFormat): string {
  if (value === null || value === undefined) return '\u2014';
  if (format && typeof value === 'number') return formatKPIValue(value, format);
  if (typeof value === 'number') return value.toLocaleString('en-US');
  return String(value);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface DataTableProps extends WidgetRenderProps<TableData> {
  showActions?: boolean;
  onRemove?: () => void;
  onDuplicate?: () => void;
  onRowClick?: (row: Record<string, unknown>) => void;
}

export function DataTable({
  data,
  loading,
  error,
  showActions,
  onRemove,
  onDuplicate,
  onRowClick,
}: DataTableProps) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  const handleSort = useCallback(
    (key: string, sortable?: boolean) => {
      if (!sortable) return;
      if (sortKey === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : d === 'desc' ? null : 'asc'));
        if (sortDir === 'desc') setSortKey(null);
      } else {
        setSortKey(key);
        setSortDir('asc');
      }
    },
    [sortKey, sortDir],
  );

  const sortedRows = useMemo(() => {
    if (!data?.rows) return [];
    if (!sortKey || !sortDir) return data.rows;
    return [...data.rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data?.rows, sortKey, sortDir]);

  const columns = data?.columns ?? [];

  return (
    <WidgetShell
      title={data?.title}
      loading={loading}
      error={error}
      showActions={showActions}
      onRemove={onRemove}
      onDuplicate={onDuplicate}
    >
      <div className="overflow-auto h-full w-full">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              {columns.map((col, idx) => (
                <th
                  key={col.key}
                  className={cn(
                    'py-2 px-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap',
                    'bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
                    'border-b border-slate-200/70 dark:border-slate-700/70',
                    col.align === 'right' && 'text-right',
                    col.align === 'center' && 'text-center',
                    idx === 0 && data?.stickyFirstColumn && 'sticky left-0 z-20 bg-slate-50 dark:bg-slate-800',
                    col.sortable && 'cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-200',
                    col.highlight,
                  )}
                  style={col.width ? { width: col.width } : undefined}
                  onClick={() => handleSort(col.key, col.sortable)}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {col.sortable && sortKey === col.key && sortDir === 'asc' && <ArrowUp className="h-3 w-3" />}
                    {col.sortable && sortKey === col.key && sortDir === 'desc' && <ArrowDown className="h-3 w-3" />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, ri) => (
              <tr
                key={ri}
                className={cn(
                  'border-b border-slate-100 dark:border-slate-800/50 transition-colors',
                  'hover:bg-slate-50 dark:hover:bg-slate-800/30',
                  onRowClick && 'cursor-pointer',
                )}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((col, ci) => (
                  <td
                    key={col.key}
                    className={cn(
                      'py-2 px-3 font-mono text-sm',
                      'text-slate-800 dark:text-slate-200',
                      col.align === 'right' && 'text-right',
                      col.align === 'center' && 'text-center',
                      ci === 0 && data?.stickyFirstColumn && 'sticky left-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700',
                      col.highlight,
                    )}
                  >
                    {formatCell(row[col.key], col.format)}
                  </td>
                ))}
              </tr>
            ))}
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="py-8 text-center text-slate-400 dark:text-slate-500 text-sm">
                  No data available
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </WidgetShell>
  );
}
