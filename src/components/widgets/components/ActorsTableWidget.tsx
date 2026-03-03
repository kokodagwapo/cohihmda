/**
 * Workbench widget: single Actors table (one of 4 dimension slots).
 * Uses config for dimension, turnTimeLabel, onDimensionChange, onRowClick from WidgetGroup.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, Search, Maximize2, Download, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WidgetRenderProps } from '../registry/types';
import type {
  ActorRow,
  ActorsTableResult,
  ActorDimension,
} from '@/hooks/useActorsData';
import { ACTORS_TABLE_DEFAULT_COLUMN_IDS } from '@/stores/widgetSectionStore';

const DIMENSION_LABELS: Record<ActorDimension, string> = {
  channel: 'Channel',
  processor: 'Processor',
  closer: 'Closer',
  underwriter: 'Underwriter',
  loan_officer: 'Loan Officer',
  branch: 'Branch',
  investor: 'Investor',
  warehouse_co_name: 'Warehouse Co Name',
};

type ActorTableSortKey =
  | 'name'
  | 'units'
  | 'volume'
  | 'avgAppToFund'
  | 'approvalPct'
  | 'deniedPct'
  | 'withdrawnPct'
  | 'loanComplexity';

function getActorSortValue(row: ActorRow, key: ActorTableSortKey): number | string | null {
  switch (key) {
    case 'name':
      return row.name?.trim() ?? '';
    case 'units':
      return row.units;
    case 'volume':
      return row.volume;
    case 'avgAppToFund':
      return row.avgAppToFund ?? null;
    case 'approvalPct':
      return row.approvalPct;
    case 'deniedPct':
      return row.deniedPct;
    case 'withdrawnPct':
      return row.withdrawnPct;
    case 'loanComplexity':
      return row.loanComplexity ?? null;
    default:
      return null;
  }
}

function sortActorRows(
  rows: ActorRow[],
  key: ActorTableSortKey,
  direction: 'asc' | 'desc'
): ActorRow[] {
  const mult = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = getActorSortValue(a, key);
    const vb = getActorSortValue(b, key);
    const aNull = va === null || va === '';
    const bNull = vb === null || vb === '';
    if (aNull && bNull) return 0;
    if (aNull) return mult * 1;
    if (bNull) return mult * -1;
    if (typeof va === 'number' && typeof vb === 'number') return mult * (va - vb);
    return mult * String(va).localeCompare(String(vb), undefined, { numeric: true });
  });
}

export function ActorsTableWidget({
  data,
  loading,
  error,
  width,
  height,
  config,
}: WidgetRenderProps<ActorsTableResult | null>) {
  const tableData = data;
  const tableIndex = (config?.tableIndex as number) ?? 0;
  const turnTimeLabel = (config?.turnTimeLabel as string) ?? 'Avg App to Fund';
  const dimension = (config?.dimension as ActorDimension) ?? 'loan_officer';
  const dimensionLabel = (config?.dimensionLabel as string) ?? DIMENSION_LABELS[dimension];
  const dimensionOptions = (config?.dimensionOptions as ActorDimension[]) ?? [
    'loan_officer',
    'processor',
    'underwriter',
    'closer',
  ];
  const onDimensionChange = config?.onDimensionChange as ((index: number, value: ActorDimension) => void) | undefined;
  const onRowClick = config?.onRowClick as ((dimension: ActorDimension, name: string) => void) | undefined;
  const visibleColumnIds = (config?.visibleColumnIds as string[] | undefined)?.length
    ? (config.visibleColumnIds as string[])
    : [...ACTORS_TABLE_DEFAULT_COLUMN_IDS];

  const [modalOpen, setModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortColumnId, setSortColumnId] = useState<ActorTableSortKey>('units');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const filteredRows = useMemo(() => {
    if (!tableData?.rows) return [];
    if (!searchQuery.trim()) return tableData.rows;
    const q = searchQuery.trim().toLowerCase();
    return tableData.rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [tableData?.rows, searchQuery]);

  const sortedRows = useMemo(
    () => sortActorRows(filteredRows, sortColumnId, sortDirection),
    [filteredRows, sortColumnId, sortDirection]
  );

  const handleSort = useCallback((columnId: ActorTableSortKey) => {
    setSortColumnId((prev) => {
      if (prev === columnId) {
        setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDirection('desc');
      return columnId;
    });
  }, []);

  const totals = tableData?.totals;
  const avgTurnTime = totals?.avgAppToFund ?? null;
  const avgApproval = totals?.approvalPct ?? 0;
  const avgDenied = totals?.deniedPct ?? 0;
  const avgWithdrawn = totals?.withdrawnPct ?? 0;

  const formatVolume = (n: number) => {
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
    return `$${n.toFixed(0)}`;
  };

  const headerColumns = useMemo(() => {
    const all: { id: ActorTableSortKey; label: string; align: 'left' | 'right' }[] = [
      { id: 'name', label: 'Actor', align: 'left' },
      { id: 'units', label: 'Units', align: 'right' },
      { id: 'volume', label: 'Volume', align: 'right' },
      { id: 'avgAppToFund', label: turnTimeLabel, align: 'right' },
      { id: 'approvalPct', label: 'Approval %', align: 'right' },
      { id: 'deniedPct', label: 'Denied %', align: 'right' },
      { id: 'withdrawnPct', label: 'Withdrawn %', align: 'right' },
      { id: 'loanComplexity', label: 'Complexity', align: 'right' },
    ];
    const idToCol = new Map(all.map((c) => [c.id, c]));
    return visibleColumnIds.map((id) => idToCol.get(id as ActorTableSortKey)).filter(Boolean) as typeof all;
  }, [visibleColumnIds, turnTimeLabel]);

  const getCellCsvValue = useCallback(
    (colId: ActorTableSortKey, data: ActorRow | NonNullable<ActorsTableResult['totals']>) => {
      if (colId === 'name') return data.name;
      if (colId === 'units') return data.units;
      if (colId === 'volume') return formatVolume(data.volume);
      if (colId === 'avgAppToFund') return data.avgAppToFund != null ? data.avgAppToFund.toFixed(2) : '-';
      if (colId === 'approvalPct') return data.approvalPct.toFixed(1) + '%';
      if (colId === 'deniedPct') return data.deniedPct.toFixed(1) + '%';
      if (colId === 'withdrawnPct') return data.withdrawnPct.toFixed(1) + '%';
      if (colId === 'loanComplexity') return data.loanComplexity != null ? data.loanComplexity.toFixed(1) : '-';
      return '-';
    },
    []
  );

  const exportToCsv = useCallback(() => {
    const escapeCsv = (v: string | number | null | undefined) => {
      const raw = String(v ?? '');
      const s = raw.replace(/\u2014|\u2013/g, '-'); // Use ASCII hyphen for CSV/Excel compatibility
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const rows: string[][] = [];
    rows.push(headerColumns.map((c) => escapeCsv(c.label)));
    if (totals) {
      rows.push(headerColumns.map((c) => escapeCsv(getCellCsvValue(c.id, totals))));
    }
    sortedRows.forEach((row) => {
      rows.push(headerColumns.map((c) => escapeCsv(getCellCsvValue(c.id, row))));
    });
    const csv = rows.map((row) => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const safeLabel = dimensionLabel.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    link.download = `actors-${safeLabel}-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, [headerColumns, totals, sortedRows, dimensionLabel, getCellCsvValue]);

  if (error) {
    return (
      <Card className="border border-slate-200 dark:border-slate-700 h-full">
        <CardContent className="flex items-center justify-center py-8 text-sm text-red-600 dark:text-red-400">
          {error}
        </CardContent>
      </Card>
    );
  }

  const colCount = headerColumns.length;

  const renderCell = useCallback(
    (colId: ActorTableSortKey, data: ActorRow | NonNullable<ActorsTableResult['totals']>, isTotals: boolean) => {
      const align = colId === 'name' ? 'text-left' : 'text-right';
      const base = `py-2 px-3 ${align}`;
      if (colId === 'name') {
        return { content: isTotals ? 'Totals' : data.name, className: base + (isTotals ? '' : ' font-medium') };
      }
      if (colId === 'units') return { content: data.units, className: base };
      if (colId === 'volume') return { content: formatVolume(data.volume), className: base };
      if (colId === 'avgAppToFund') {
        const val = data.avgAppToFund;
        const cls =
          !isTotals && val != null && avgTurnTime != null
            ? val <= avgTurnTime
              ? 'bg-amber-100 dark:bg-amber-900/30'
              : 'bg-[#fe9a00]/20 dark:bg-[#fe9a00]/25'
            : '';
        const content = val != null ? (
          <>
            {val.toFixed(2)}
            {!isTotals && avgTurnTime != null && (val <= avgTurnTime ? ' ★' : ' !')}
          </>
        ) : (
          '—'
        );
        return { content, className: cn(base, cls) };
      }
      if (colId === 'approvalPct') {
        const cls = !isTotals && data.approvalPct >= avgApproval ? 'bg-emerald-100 dark:bg-emerald-900/30' : '';
        return { content: data.approvalPct.toFixed(1) + '%', className: cn(base, cls) };
      }
      if (colId === 'deniedPct') {
        const cls = !isTotals && data.deniedPct <= avgDenied ? 'bg-emerald-100 dark:bg-emerald-900/30' : '';
        return { content: data.deniedPct.toFixed(1) + '%', className: cn(base, cls) };
      }
      if (colId === 'withdrawnPct') {
        const cls = !isTotals && data.withdrawnPct <= avgWithdrawn ? 'bg-emerald-100 dark:bg-emerald-900/30' : '';
        return { content: data.withdrawnPct.toFixed(1) + '%', className: cn(base, cls) };
      }
      if (colId === 'loanComplexity') {
        return {
          content: data.loanComplexity != null ? data.loanComplexity.toFixed(1) : '—',
          className: base,
        };
      }
      return { content: '—', className: base };
    },
    [avgTurnTime, avgApproval, avgDenied, avgWithdrawn]
  );

  const renderTableBody = (inModal: boolean) => (
    <>
      {loading ? (
        <tr>
          <td colSpan={colCount} className="py-8 text-center text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
            Loading...
          </td>
        </tr>
      ) : sortedRows.length === 0 ? (
        <tr>
          <td colSpan={colCount} className="py-6 text-center text-slate-500">
            No data
          </td>
        </tr>
      ) : (
        <>
          {totals &&
            headerColumns.length > 0 && (
              <tr className="bg-slate-50 dark:bg-slate-800 font-medium border-b border-slate-200 dark:border-slate-700">
                {headerColumns.map((col) => {
                  const { content, className } = renderCell(col.id, totals, true);
                  return (
                    <td key={col.id} className={className}>
                      {content}
                    </td>
                  );
                })}
              </tr>
            )}
          {sortedRows.map((row) => (
            <tr
              key={row.name}
              className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 cursor-pointer"
              onClick={() => {
                onRowClick?.(dimension, row.name);
                if (inModal) setModalOpen(false);
              }}
            >
              {headerColumns.map((col) => {
                const { content, className } = renderCell(col.id, row, false);
                return (
                  <td key={col.id} className={className}>
                    {content}
                  </td>
                );
              })}
            </tr>
          ))}
        </>
      )}
    </>
  );

  return (
    <>
      <Card className="border border-slate-200 dark:border-slate-700 h-full flex flex-col">
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Select
              value={dimension}
              onValueChange={(v) => onDimensionChange?.(tableIndex, v as ActorDimension)}
              disabled={!onDimensionChange}
            >
              <SelectTrigger className="w-[180px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {dimensionOptions.map((d) => (
                  <SelectItem key={d} value={d}>
                    {DIMENSION_LABELS[d]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center w-[160px] rounded-md border border-input bg-background pl-2 pr-2">
              <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              <input
                type="text"
                placeholder={`Search ${dimensionLabel}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 flex-1 min-w-0 bg-transparent text-sm border-0 focus:outline-none focus:ring-0"
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              onClick={exportToCsv}
              disabled={!tableData?.rows?.length}
              aria-label="Export table to CSV"
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              onClick={() => setModalOpen(true)}
              aria-label="Open table in full screen"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 flex-1 min-h-0 overflow-hidden">
          <div className="h-[320px] overflow-auto overflow-x-auto border-t border-slate-200 dark:border-slate-700">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="sticky top-0 z-10 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                  {headerColumns.map((col) => {
                    const isSorted = sortColumnId === col.id;
                    return (
                      <th
                        key={col.id}
                        className={cn(
                          'py-2 px-3 font-medium cursor-pointer select-none hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors',
                          col.align === 'right' ? 'text-right' : 'text-left'
                        )}
                        onClick={() => handleSort(col.id)}
                        role="columnheader"
                        aria-sort={
                          isSorted
                            ? sortDirection === 'asc'
                              ? 'ascending'
                              : 'descending'
                            : undefined
                        }
                      >
                        <span className="inline-flex items-center gap-1">
                          {col.label}
                          {isSorted &&
                            (sortDirection === 'asc' ? (
                              <ArrowUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            ) : (
                              <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            ))}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>{renderTableBody(false)}</tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent
          className="max-w-[95vw] w-full max-h-[90vh] flex flex-col gap-0 p-0"
          hideCloseButton={false}
        >
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle>{dimensionLabel} — Full screen</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-auto px-6 pb-6">
            <div className="overflow-auto border rounded-lg border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                    {headerColumns.map((col) => {
                      const isSorted = sortColumnId === col.id;
                      return (
                        <th
                          key={col.id}
                          className={cn(
                            'py-2 px-3 font-medium cursor-pointer select-none hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors',
                            col.align === 'right' ? 'text-right' : 'text-left'
                          )}
                          onClick={() => handleSort(col.id)}
                          role="columnheader"
                          aria-sort={
                            isSorted
                              ? sortDirection === 'asc'
                                ? 'ascending'
                                : 'descending'
                              : undefined
                          }
                        >
                          <span className="inline-flex items-center gap-1">
                            {col.label}
                            {isSorted &&
                              (sortDirection === 'asc' ? (
                                <ArrowUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              ) : (
                                <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              ))}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>{renderTableBody(true)}</tbody>
              </table>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
