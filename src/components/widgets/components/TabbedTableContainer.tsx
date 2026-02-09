/**
 * TabbedTableContainer – a widget that holds multiple table views
 * in tabs within a single card.
 *
 * Used for Summary / Detail table combinations in the workbench.
 * Each tab renders a full DataTable.
 */

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { ArrowUp, ArrowDown } from 'lucide-react';
import type { WidgetRenderProps, TabbedTableData, TableColumn, KPIFormat } from '../registry/types';
import { formatKPIValue } from './KPICard';
import { WidgetShell } from './WidgetShell';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

export interface TabbedTableContainerProps extends WidgetRenderProps<TabbedTableData> {
  showActions?: boolean;
  onRemove?: () => void;
  onDuplicate?: () => void;
}

export function TabbedTableContainer({
  data,
  loading,
  error,
  showActions,
  onRemove,
  onDuplicate,
}: TabbedTableContainerProps) {
  const [activeTab, setActiveTab] = useState<string>(
    data?.defaultTab ?? data?.tabs[0]?.id ?? '',
  );
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  const tabs = data?.tabs ?? [];
  const currentTab = tabs.find((t) => t.id === activeTab) ?? tabs[0];
  const tableData = currentTab?.table;
  const columns = tableData?.columns ?? [];

  const handleTabChange = (id: string) => {
    setActiveTab(id);
    setSortKey(null);
    setSortDir(null);
  };

  const handleSort = (key: string, sortable?: boolean) => {
    if (!sortable) return;
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : d === 'desc' ? null : 'asc'));
      if (sortDir === 'desc') setSortKey(null);
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortedRows = React.useMemo(() => {
    if (!tableData?.rows) return [];
    if (!sortKey || !sortDir) return tableData.rows;
    return [...tableData.rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [tableData?.rows, sortKey, sortDir]);

  return (
    <WidgetShell
      title={data?.title}
      loading={loading}
      error={error}
      showActions={showActions}
      onRemove={onRemove}
      onDuplicate={onDuplicate}
    >
      <div className="flex flex-col h-full w-full overflow-hidden">
        {/* Tab bar */}
        {tabs.length > 1 && (
          <div className="flex border-b border-slate-200 dark:border-slate-700 shrink-0">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id)}
                className={cn(
                  'px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-colors',
                  'hover:bg-slate-50 dark:hover:bg-slate-800/40',
                  activeTab === tab.id
                    ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-500'
                    : 'text-slate-500 dark:text-slate-400',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* Table */}
        <div className="overflow-auto flex-1 min-h-0">
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
                      idx === 0 &&
                        tableData?.stickyFirstColumn &&
                        'sticky left-0 z-20 bg-slate-50 dark:bg-slate-800',
                      col.sortable &&
                        'cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-200',
                      col.highlight,
                    )}
                    style={col.width ? { width: col.width } : undefined}
                    onClick={() => handleSort(col.key, col.sortable)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {col.sortable &&
                        sortKey === col.key &&
                        sortDir === 'asc' && <ArrowUp className="h-3 w-3" />}
                      {col.sortable &&
                        sortKey === col.key &&
                        sortDir === 'desc' && (
                          <ArrowDown className="h-3 w-3" />
                        )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, ri) => {
                // Support section header rows (rows that span the full table)
                if (row._sectionHeader) {
                  return (
                    <tr key={ri}>
                      <td
                        colSpan={columns.length}
                        className="py-2 px-3 text-xs font-semibold bg-slate-50 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300"
                      >
                        {String(row._sectionHeader)}
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr
                    key={ri}
                    className={cn(
                      'border-b border-slate-100 dark:border-slate-800/50 transition-colors',
                      'hover:bg-slate-50 dark:hover:bg-slate-800/30',
                    )}
                  >
                    {columns.map((col, ci) => (
                      <td
                        key={col.key}
                        className={cn(
                          'py-2 px-3 font-mono text-sm',
                          'text-slate-800 dark:text-slate-200',
                          col.align === 'right' && 'text-right',
                          col.align === 'center' && 'text-center',
                          ci === 0 &&
                            tableData?.stickyFirstColumn &&
                            'sticky left-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700',
                          col.highlight,
                        )}
                      >
                        {formatCell(row[col.key], col.format)}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {sortedRows.length === 0 && (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="py-8 text-center text-slate-400 dark:text-slate-500 text-sm"
                  >
                    No data available
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </WidgetShell>
  );
}
