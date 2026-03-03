/**
 * Workbench widget: single High Performers rankings table (Branch or Loan Officer, Left or Right).
 * Uses section filters from WidgetDataProvider (date type + left/right period).
 */

import React, { useState, useMemo } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ExportData } from '@/utils/exportUtils';
import { exportDataAsExcel } from '@/utils/exportUtils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useWidgetSectionStore } from '@/stores/widgetSectionStore';
import type { WidgetRenderProps } from '../registry/types';
import type { HighPerformerRow } from '@/hooks/useHighPerformersData';
import { Search, Loader2, Download } from 'lucide-react';

const PERIOD_OPTIONS: { value: string; label: string }[] = [
  { value: 'mtd', label: 'MTD' },
  { value: 'lm', label: 'Last Month' },
  { value: 'ytd', label: 'YTD' },
  { value: 'ly', label: 'Last Year' },
  { value: 'rolling_13', label: 'Rolling 13 Months' },
];

function formatVolume(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function formatPct(n: number): string {
  return `${(Math.round(n * 10) / 10).toFixed(1)}%`;
}

function escapeCsvCell(val: string | number | null | undefined): string {
  const raw = String(val ?? '');
  const s = raw.replace(/\u2014|\u2013/g, '-'); // Use ASCII hyphen for CSV/Excel compatibility
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function HighPerformersRankingsTableWidget({
  data,
  loading,
  error,
  width,
  height,
  config,
}: WidgetRenderProps<HighPerformerRow[] | null>) {
  const title = (config?.title as string) ?? 'Rankings';
  const nameLabel = (config?.nameLabel as string) ?? 'Name';
  const exportFileName = (config?.exportFileName as string) ?? 'rankings';
  const sectionId = config?.sectionId as string | undefined;
  const periodKey = config?.periodKey as 'left' | 'right' | undefined;
  const period = (config?.period as string) ?? 'mtd';

  const updateFilters = useWidgetSectionStore((s) => s.updateFilters);
  const onPeriodChange = (value: string) => {
    if (!sectionId || !periodKey) return;
    if (periodKey === 'left') {
      updateFilters(sectionId, { highPerformersLeftPeriod: value });
    } else {
      updateFilters(sectionId, { highPerformersRightPeriod: value });
    }
  };

  const [searchQuery, setSearchQuery] = useState('');
  const rows = data ?? [];

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, searchQuery]);

  const totals = useMemo(() => {
    const units = filtered.reduce((s, r) => s + r.units, 0);
    const volume = filtered.reduce((s, r) => s + r.volume, 0);
    if (units === 0)
      return {
        units: 0,
        volume: 0,
        pctGovt: 0,
        pctConv: 0,
        pctRefi: 0,
        pctPurch: 0,
      };
    const pctGovt = filtered.reduce((s, r) => s + r.pctGovt * r.units, 0) / units;
    const pctConv = filtered.reduce((s, r) => s + r.pctConv * r.units, 0) / units;
    const pctRefi = filtered.reduce((s, r) => s + r.pctRefi * r.units, 0) / units;
    const pctPurch = filtered.reduce((s, r) => s + r.pctPurch * r.units, 0) / units;
    return { units, volume, pctGovt, pctConv, pctRefi, pctPurch };
  }, [filtered]);

  const headers = [nameLabel, 'Units', 'Volume', 'Rank', '% Govt', '% Conv', '% Refi', '% Purch'];
  const exportRows = useMemo(() => {
    const dataRows = filtered.map((r) => [
      r.name,
      r.units,
      formatVolume(r.volume),
      r.rank,
      formatPct(r.pctGovt),
      formatPct(r.pctConv),
      formatPct(r.pctRefi),
      formatPct(r.pctPurch),
    ]);
    if (filtered.length > 0) {
      dataRows.push([
        'Totals',
        totals.units,
        formatVolume(totals.volume),
        '-',
        formatPct(totals.pctGovt),
        formatPct(totals.pctConv),
        formatPct(totals.pctRefi),
        formatPct(totals.pctPurch),
      ]);
    }
    return dataRows;
  }, [filtered, totals]);

  const handleDownloadCsv = () => {
    const base = exportFileName.replace(/[\s/]+/g, '-').toLowerCase();
    const filename = `${base}-${new Date().toISOString().split('T')[0]}.csv`;
    const csvHeader = headers.map(escapeCsvCell).join(',');
    const csvData = exportRows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
    const csv = [csvHeader, csvData].filter(Boolean).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadExcel = async () => {
    const base = exportFileName.replace(/[\s/]+/g, '-').toLowerCase();
    const filename = `${base}-${new Date().toISOString().split('T')[0]}`;
    const exportData: ExportData = {
      title,
      tables: [{ name: title, headers, rows: exportRows }],
    };
    await exportDataAsExcel(exportData, filename);
  };

  const tableHeight = height != null && height > 200 ? Math.max(200, height - 120) : 280;

  return (
    <div className="h-full w-full flex flex-col min-h-0 overflow-hidden">
      <Card className="border border-slate-200 dark:border-slate-700 flex-1 flex flex-col min-h-0">
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 flex-wrap shrink-0">
          <CardTitle className="text-base font-semibold">{title}</CardTitle>
          <div className="flex items-center gap-2">
            {sectionId != null && periodKey != null && (
              <Select value={period} onValueChange={onPeriodChange}>
                <SelectTrigger className="h-8 w-[130px] text-sm">
                  <SelectValue placeholder="Period" />
                </SelectTrigger>
                <SelectContent>
                  {PERIOD_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5">
                  <Download className="h-4 w-4" />
                  Download
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleDownloadCsv}>CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={handleDownloadExcel}>Excel</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
        <CardContent className="p-0 flex-1 flex flex-col min-h-0">
          <div className="flex items-center gap-2 px-3 pb-2 shrink-0">
            <div className="flex items-center flex-1 min-w-0 rounded-md border border-input bg-background">
              <Search className="h-4 w-4 shrink-0 text-slate-400 ml-3" aria-hidden />
              <Input
                placeholder={`Search ${nameLabel}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 text-sm border-0 pl-2 pr-3 focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </div>
          </div>
          <div
            className="flex-1 min-h-0 overflow-auto overflow-x-auto border-t border-slate-200 dark:border-slate-700"
            style={{ minHeight: tableHeight }}
          >
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="sticky top-0 z-10 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 shadow-[0_1px_0_0_rgba(0,0,0,0.1)] dark:shadow-[0_1px_0_0_rgba(255,255,255,0.05)]">
                  <th className="text-left py-2 px-3 font-medium bg-slate-50 dark:bg-slate-800">{nameLabel}</th>
                  <th className="text-right py-2 px-3 font-medium bg-slate-50 dark:bg-slate-800">Units</th>
                  <th className="text-right py-2 px-3 font-medium bg-slate-50 dark:bg-slate-800">Volume</th>
                  <th className="text-right py-2 px-3 font-medium bg-slate-50 dark:bg-slate-800">Rank</th>
                  <th className="text-right py-2 px-3 font-medium bg-slate-50 dark:bg-slate-800">% Govt</th>
                  <th className="text-right py-2 px-3 font-medium bg-slate-50 dark:bg-slate-800">% Conv</th>
                  <th className="text-right py-2 px-3 font-medium bg-slate-50 dark:bg-slate-800">% Refi</th>
                  <th className="text-right py-2 px-3 font-medium bg-slate-50 dark:bg-slate-800">% Purch</th>
                </tr>
              </thead>
              <tbody>
                {error ? (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-destructive text-sm">
                      {error}
                    </td>
                  </tr>
                ) : loading ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                      Loading...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-slate-500">
                      No data for this period
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr
                      key={`${r.name}-${r.rank}`}
                      className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30"
                    >
                      <td className="py-2 px-3 font-medium">{r.name}</td>
                      <td className="text-right py-2 px-3">{r.units}</td>
                      <td className="text-right py-2 px-3">{formatVolume(r.volume)}</td>
                      <td className="text-right py-2 px-3">{r.rank}</td>
                      <td className="text-right py-2 px-3">{formatPct(r.pctGovt)}</td>
                      <td className="text-right py-2 px-3">{formatPct(r.pctConv)}</td>
                      <td className="text-right py-2 px-3">{formatPct(r.pctRefi)}</td>
                      <td className="text-right py-2 px-3">{formatPct(r.pctPurch)}</td>
                    </tr>
                  ))
                )}
                {!loading && !error && filtered.length > 0 && (
                  <tr className="sticky bottom-0 z-10 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-medium shadow-[0_-1px_0_0_rgba(0,0,0,0.1)] dark:shadow-[0_-1px_0_0_rgba(255,255,255,0.05)]">
                    <td className="py-2 px-3 bg-slate-50 dark:bg-slate-800">Totals</td>
                    <td className="text-right py-2 px-3 bg-slate-50 dark:bg-slate-800">{totals.units}</td>
                    <td className="text-right py-2 px-3 bg-slate-50 dark:bg-slate-800">{formatVolume(totals.volume)}</td>
                    <td className="text-right py-2 px-3 bg-slate-50 dark:bg-slate-800">—</td>
                    <td className="text-right py-2 px-3 bg-slate-50 dark:bg-slate-800">{formatPct(totals.pctGovt)}</td>
                    <td className="text-right py-2 px-3 bg-slate-50 dark:bg-slate-800">{formatPct(totals.pctConv)}</td>
                    <td className="text-right py-2 px-3 bg-slate-50 dark:bg-slate-800">{formatPct(totals.pctRefi)}</td>
                    <td className="text-right py-2 px-3 bg-slate-50 dark:bg-slate-800">{formatPct(totals.pctPurch)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
