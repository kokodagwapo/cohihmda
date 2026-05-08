/**
 * Pipeline Analysis workbench widgets (Table, Volume/Units Chart, LO Count Chart).
 * Same data and layout as Pipeline Analysis page; uses default filters (application_date, no filters).
 */

import React, { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ComposedChart,
  Bar,
  Cell,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from 'recharts';
import { Loader2 } from 'lucide-react';
import type { WidgetRenderProps } from '../registry/types';
import type { PipelineSnapshotRow } from '@/hooks/usePipelineAnalysisData';
import { WidgetShell } from './WidgetShell';

// ---------------------------------------------------------------------------
// Helpers (match PipelineAnalysisView)
// ---------------------------------------------------------------------------

function formatVolume(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatPct(value: number | null): string {
  if (value === null || value === undefined) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatUnitsPerActor(units: number, count: number): string {
  if (count == null || count <= 0) return '—';
  return (units / count).toFixed(1);
}

/** Returns Tailwind background class for heatmap: bottom 35% red, middle 30% yellow, top 35% green (by percentile). */
function heatmapClass(value: number | null, p35: number, p65: number): string {
  if (value == null || !Number.isFinite(p35) || !Number.isFinite(p65)) return '';
  if (value <= p35) return 'bg-red-100 dark:bg-red-950/50';
  if (value >= p65) return 'bg-emerald-100 dark:bg-emerald-950/50';
  return 'bg-yellow-100 dark:bg-yellow-950/50';
}

function ordinal(n: number): string {
  const s = n % 10;
  const t = n % 100;
  if (s === 1 && t !== 11) return `${n}st`;
  if (s === 2 && t !== 12) return `${n}nd`;
  if (s === 3 && t !== 13) return `${n}rd`;
  return `${n}th`;
}

const SNAPSHOT_DAY_LABELS: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
};

const ALL_WEEK_VALUES = Array.from({ length: 53 }, (_, i) => i + 1);
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface PipelineAnalysisSource {
  snapshots: PipelineSnapshotRow[];
  range: { minYear: number | null; maxYear: number | null } | null;
  config: { snapshot_day_of_week: number } | null;
  /** Selected year range "YYYY-YYYY" (e.g. "2024-2025"). When set, table/chart years use this instead of range. */
  yearRange?: string | null;
  viewMode?: 'week' | 'month';
  pctMetric?: 'volume' | 'units';
  selectedWeekValues?: number[];
  selectedMonths?: number[];
}

interface PipelineAnalysisWidgetConfig {
  selectedWeekValues?: number[];
  selectedMonths?: number[];
  onToggleWeek?: (week: number) => void;
  onToggleMonth?: (month: number) => void;
}

function snapshotsToByYearMonth(snapshots: PipelineSnapshotRow[]): Map<string, PipelineSnapshotRow> {
  const byYearMonth = new Map<string, PipelineSnapshotRow>();
  for (const row of snapshots) {
    const d = typeof row.date === 'string' ? parseISO(row.date) : new Date(row.date);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const key = `${y}-${m}`;
    const existing = byYearMonth.get(key);
    const rowStr = typeof row.date === 'string' ? row.date.slice(0, 10) : format(new Date(row.date), 'yyyy-MM-dd');
    if (!existing || rowStr < (typeof existing.date === 'string' ? existing.date.slice(0, 10) : format(new Date(existing.date), 'yyyy-MM-dd'))) {
      byYearMonth.set(key, row);
    }
  }
  return byYearMonth;
}

function buildDerived(source: PipelineAnalysisSource | null) {
  if (!source?.snapshots?.length) return null;
  const snapshots = source.snapshots;
  // Use selected year range when present; otherwise fall back to range (min/max from data) so labels match filter
  let startYear: number;
  let endYear: number;
  if (source.yearRange) {
    const parts = source.yearRange.split('-').map(Number);
    if (parts.length >= 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1])) {
      startYear = parts[0];
      endYear = parts[1];
    } else {
      const minYear = source.range?.minYear ?? new Date().getFullYear() - 2;
      const maxYear = source.range?.maxYear ?? new Date().getFullYear();
      startYear = Math.max(minYear, maxYear - 1);
      endYear = maxYear;
    }
  } else {
    const minYear = source.range?.minYear ?? new Date().getFullYear() - 2;
    const maxYear = source.range?.maxYear ?? new Date().getFullYear();
    startYear = Math.max(minYear, maxYear - 1);
    endYear = maxYear;
  }
  const years = [startYear, endYear];

  const byYearWeekMap = new Map<string, PipelineSnapshotRow>();
  for (const row of snapshots) byYearWeekMap.set(`${row.year}-${row.week_value}`, row);

  const weekValues = ALL_WEEK_VALUES;

  const byWeekPct = new Map<
    number,
    {
      weeklyVolume: number | null;
      monthlyVolume: number | null;
      annualVolume: number | null;
      weeklyUnits: number | null;
      monthlyUnits: number | null;
      annualUnits: number | null;
    }
  >();
  for (const w of weekValues) {
    let best: PipelineSnapshotRow | null = null;
    for (const row of snapshots) {
      if (row.week_value !== w) continue;
      if (!best || row.year > best.year) best = row;
    }
    if (best && best.year === endYear)
      byWeekPct.set(w, {
        weeklyVolume: best.weekly_pct_change_volume,
        monthlyVolume: best.monthly_pct_change_volume,
        annualVolume: best.annual_pct_change_volume,
        weeklyUnits: best.weekly_pct_change_units,
        monthlyUnits: best.monthly_pct_change_units,
        annualUnits: best.annual_pct_change_units,
      });
  }

  const snapshotDayLabel =
    snapshots[0]?.snapshot_weekday ?? SNAPSHOT_DAY_LABELS[source.config?.snapshot_day_of_week ?? 1] ?? 'Monday';

  const viewMode = source.viewMode ?? 'week';
  const byYearMonth = snapshotsToByYearMonth(snapshots);

  const pipelineChartDataWeek = weekValues.map((w) => {
    const point: Record<string, number | string | null> = { week: w, weekLabel: ordinal(w) };
    years.forEach((y) => {
      const row = byYearWeekMap.get(`${y}-${w}`);
      point[`${y} Volume`] = row?.active_volume ?? null;
      point[`${y} Units`] = row?.active_units ?? null;
    });
    return point;
  });

  const pipelineChartDataMonth = MONTH_LABELS.map((label, i) => {
    const month = i + 1;
    const point: Record<string, number | string | null> = { periodLabel: label, month };
    years.forEach((y) => {
      const row = byYearMonth.get(`${y}-${month}`);
      point[`${y} Volume`] = row?.active_volume ?? null;
      point[`${y} Units`] = row?.active_units ?? null;
    });
    return point;
  });

  const pipelineLoCountChartDataWeek = weekValues.map((w) => {
    const point: Record<string, number | string | null> = { week: w, weekLabel: ordinal(w) };
    years.forEach((y) => {
      const row = byYearWeekMap.get(`${y}-${w}`);
      point[`${y} LO Count`] = row?.active_lo_count ?? null;
      point[`${y} Units`] = row?.active_units ?? null;
    });
    return point;
  });

  const pipelineLoCountChartDataMonth = MONTH_LABELS.map((label, i) => {
    const month = i + 1;
    const point: Record<string, number | string | null> = { periodLabel: label, month };
    years.forEach((y) => {
      const row = byYearMonth.get(`${y}-${month}`);
      point[`${y} LO Count`] = row?.active_lo_count ?? null;
      point[`${y} Units`] = row?.active_units ?? null;
    });
    return point;
  });

  const byMonthPct = new Map<
    number,
    { weeklyVolume: number | null; monthlyVolume: number | null; annualVolume: number | null; weeklyUnits: number | null; monthlyUnits: number | null; annualUnits: number | null }
  >();
  const mostRecentYear = endYear;
  if (mostRecentYear != null) {
    for (let month = 1; month <= 12; month++) {
      const row = byYearMonth.get(`${mostRecentYear}-${month}`);
      if (row) {
        byMonthPct.set(month, {
          weeklyVolume: row.weekly_pct_change_volume,
          monthlyVolume: row.monthly_pct_change_volume,
          annualVolume: row.annual_pct_change_volume,
          weeklyUnits: row.weekly_pct_change_units,
          monthlyUnits: row.monthly_pct_change_units,
          annualUnits: row.annual_pct_change_units,
        });
      }
    }
  }

  const pipelineChartData = viewMode === 'month' ? pipelineChartDataMonth : pipelineChartDataWeek;
  const pipelineLoCountChartData = viewMode === 'month' ? pipelineLoCountChartDataMonth : pipelineLoCountChartDataWeek;
  const chartXKey = viewMode === 'month' ? 'periodLabel' : 'weekLabel';

  return {
    years,
    weekValues,
    byYearWeek: byYearWeekMap,
    byWeekPct,
    byYearMonth,
    byMonthPct,
    snapshotDayLabel,
    pipelineChartData,
    pipelineLoCountChartData,
    chartXKey,
    viewMode,
    pctMetric: source.pctMetric ?? 'volume',
    selectedWeekValues: source.selectedWeekValues ?? [],
    selectedMonths: source.selectedMonths ?? [],
  };
}

// ---------------------------------------------------------------------------
// Table Widget
// ---------------------------------------------------------------------------

export function PipelineAnalysisTableWidget({
  data,
  loading,
  error,
  width,
  height,
  config,
}: WidgetRenderProps<PipelineAnalysisSource>) {
  const derived = useMemo(() => buildDerived(data), [data]);
  const widgetConfig = (config ?? {}) as PipelineAnalysisWidgetConfig;

  const monthHeatmapAvgs = useMemo(() => {
    if (!derived?.years?.length || !derived?.byYearMonth) {
      return { p35LO: 0, p65LO: 0, p35OPs: 0, p65OPs: 0 };
    }
    const { years, byYearMonth } = derived;
    const lo: number[] = [];
    const op: number[] = [];
    years.forEach((y) => {
      for (let m = 1; m <= 12; m++) {
        const row = byYearMonth.get(`${y}-${m}`);
        if (row && row.active_lo_count > 0) lo.push(row.active_units / row.active_lo_count);
        if (row && row.active_ops_count > 0) op.push(row.active_units / row.active_ops_count);
      }
    });
    const sortedLO = [...lo].sort((a, b) => a - b);
    const sortedOP = [...op].sort((a, b) => a - b);
    const nLO = sortedLO.length;
    const nOP = sortedOP.length;
    return {
      p35LO: nLO > 0 ? sortedLO[Math.floor(0.35 * nLO)] : 0,
      p65LO: nLO > 0 ? sortedLO[Math.floor(0.65 * nLO)] : 0,
      p35OPs: nOP > 0 ? sortedOP[Math.floor(0.35 * nOP)] : 0,
      p65OPs: nOP > 0 ? sortedOP[Math.floor(0.65 * nOP)] : 0,
    };
  }, [derived]);

  const weekHeatmapAvgs = useMemo(() => {
    if (!derived?.years?.length || !derived?.byYearWeek || !derived?.weekValues?.length) {
      return { p35LO: 0, p65LO: 0, p35OPs: 0, p65OPs: 0 };
    }
    const { years, byYearWeek, weekValues } = derived;
    const lo: number[] = [];
    const op: number[] = [];
    const weeks = weekValues.slice(0, 26);
    years.forEach((y) => {
      weeks.forEach((w) => {
        const row = byYearWeek.get(`${y}-${w}`);
        if (row && row.active_lo_count > 0) lo.push(row.active_units / row.active_lo_count);
        if (row && row.active_ops_count > 0) op.push(row.active_units / row.active_ops_count);
      });
    });
    const sortedLO = [...lo].sort((a, b) => a - b);
    const sortedOP = [...op].sort((a, b) => a - b);
    const nLO = sortedLO.length;
    const nOP = sortedOP.length;
    return {
      p35LO: nLO > 0 ? sortedLO[Math.floor(0.35 * nLO)] : 0,
      p65LO: nLO > 0 ? sortedLO[Math.floor(0.65 * nLO)] : 0,
      p35OPs: nOP > 0 ? sortedOP[Math.floor(0.35 * nOP)] : 0,
      p65OPs: nOP > 0 ? sortedOP[Math.floor(0.65 * nOP)] : 0,
    };
  }, [derived]);

  if (loading) {
    return (
      <WidgetShell loading>
        <div className="flex items-center justify-center gap-2 text-slate-500 h-full">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      </WidgetShell>
    );
  }
  if (error) {
    return (
      <WidgetShell error={error}>
        <p className="text-sm text-destructive">{error}</p>
      </WidgetShell>
    );
  }
  if (!derived || derived.years.length === 0 || (derived.viewMode === 'week' ? derived.weekValues.length === 0 : false)) {
    return (
      <WidgetShell title="Pipeline Analysis Table">
        <div className="text-muted-foreground text-sm py-8 text-center">No data to display.</div>
      </WidgetShell>
    );
  }

  const {
    years,
    byYearWeek,
    byWeekPct,
    byYearMonth,
    snapshotDayLabel,
    viewMode,
    pctMetric,
    selectedWeekValues,
    selectedMonths,
  } = derived;
  const pctMetricLabel = pctMetric === 'volume' ? 'Volume' : 'Units';

  if (viewMode === 'month') {
    const { byYearMonth, byMonthPct } = derived;
    return (
      <WidgetShell title="Active Pipeline Analysis – Table">
        <div className="h-full min-h-0 overflow-auto border rounded-md text-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[100px] sticky left-0 bg-background z-10 font-semibold" />
                {MONTH_LABELS.map((label, i) => (
                  <TableHead
                    key={label}
                    className={`text-right whitespace-nowrap ${selectedMonths.includes(i + 1) ? "bg-sky-100 dark:bg-sky-900/40" : ""}`}
                    onClick={() => widgetConfig.onToggleMonth?.(i + 1)}
                  >
                    {label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {years.map((year) => (
                <TableRow key={`vol-${year}`}>
                  <TableCell className="font-medium sticky left-0 bg-background z-10">{year} Volume</TableCell>
                  {MONTH_LABELS.map((_, i) => {
                    const month = i + 1;
                    const row = byYearMonth.get(`${year}-${month}`);
                    return (
                      <TableCell
                        key={`${year}-${month}`}
                        className={`text-right ${selectedMonths.includes(month) ? "bg-sky-100 dark:bg-sky-900/40" : ""}`}
                        onClick={() => widgetConfig.onToggleMonth?.(month)}
                      >
                        {row != null ? formatVolume(row.active_volume) : '—'}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
              {years.map((year) => (
                <TableRow key={`units-${year}`}>
                  <TableCell className="font-medium sticky left-0 bg-background z-10">{year} Units</TableCell>
                  {MONTH_LABELS.map((_, i) => {
                    const month = i + 1;
                    const row = byYearMonth.get(`${year}-${month}`);
                    return (
                      <TableCell
                        key={`${year}-${month}`}
                        className={`text-right ${selectedMonths.includes(month) ? "bg-sky-100 dark:bg-sky-900/40" : ""}`}
                        onClick={() => widgetConfig.onToggleMonth?.(month)}
                      >
                        {row != null ? row.active_units : '—'}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-medium sticky left-0 bg-background z-10 text-muted-foreground">
                  Weekly % ({pctMetricLabel})
                </TableCell>
                {MONTH_LABELS.map((_, i) => {
                  const month = i + 1;
                  const p = byMonthPct.get(month);
                  const val = pctMetric === 'volume' ? p?.weeklyVolume : p?.weeklyUnits;
                  return (
                    <TableCell
                      key={`w-${month}`}
                      className={`text-right ${selectedMonths.includes(month) ? "bg-sky-100 dark:bg-sky-900/40" : ""}`}
                      onClick={() => widgetConfig.onToggleMonth?.(month)}
                    >
                      {val != null ? formatPct(val) : '—'}
                    </TableCell>
                  );
                })}
              </TableRow>
              <TableRow>
                <TableCell className="font-medium sticky left-0 bg-background z-10 text-muted-foreground">
                  Monthly % ({pctMetricLabel})
                </TableCell>
                {MONTH_LABELS.map((_, i) => {
                  const month = i + 1;
                  const p = byMonthPct.get(month);
                  const val = pctMetric === 'volume' ? p?.monthlyVolume : p?.monthlyUnits;
                  return (
                    <TableCell
                      key={`m-${month}`}
                      className={`text-right ${selectedMonths.includes(month) ? "bg-sky-100 dark:bg-sky-900/40" : ""}`}
                      onClick={() => widgetConfig.onToggleMonth?.(month)}
                    >
                      {val != null ? formatPct(val) : '—'}
                    </TableCell>
                  );
                })}
              </TableRow>
              <TableRow>
                <TableCell className="font-medium sticky left-0 bg-background z-10 text-muted-foreground">
                  Annual % ({pctMetricLabel})
                </TableCell>
                {MONTH_LABELS.map((_, i) => {
                  const month = i + 1;
                  const p = byMonthPct.get(month);
                  const val = pctMetric === 'volume' ? p?.annualVolume : p?.annualUnits;
                  return (
                    <TableCell
                      key={`a-${month}`}
                      className={`text-right ${selectedMonths.includes(month) ? "bg-sky-100 dark:bg-sky-900/40" : ""}`}
                      onClick={() => widgetConfig.onToggleMonth?.(month)}
                    >
                      {val != null ? formatPct(val) : '—'}
                    </TableCell>
                  );
                })}
              </TableRow>
              {years.map((year) => (
                <TableRow key={`lo-${year}`}>
                  <TableCell className="font-medium sticky left-0 bg-background z-10">{year} LO Count</TableCell>
                  {MONTH_LABELS.map((_, i) => {
                    const month = i + 1;
                    const row = byYearMonth.get(`${year}-${month}`);
                    return (
                      <TableCell
                        key={`${year}-${month}`}
                        className={`text-right ${selectedMonths.includes(month) ? "bg-sky-100 dark:bg-sky-900/40" : ""}`}
                        onClick={() => widgetConfig.onToggleMonth?.(month)}
                      >
                        {row != null ? row.active_lo_count : '—'}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
              {years.map((year) => (
                <TableRow key={`ops-${year}`}>
                  <TableCell className="font-medium sticky left-0 bg-background z-10">{year} OPs Count</TableCell>
                  {MONTH_LABELS.map((_, i) => {
                    const month = i + 1;
                    const row = byYearMonth.get(`${year}-${month}`);
                    return (
                      <TableCell
                        key={`${year}-${month}`}
                        className={`text-right ${selectedMonths.includes(month) ? "bg-sky-100 dark:bg-sky-900/40" : ""}`}
                        onClick={() => widgetConfig.onToggleMonth?.(month)}
                      >
                        {row != null ? row.active_ops_count : '—'}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
              {years.map((year) => (
                <TableRow key={`uplo-${year}`}>
                  <TableCell className="font-medium sticky left-0 bg-background z-10 text-muted-foreground">{year} Units per LO</TableCell>
                  {MONTH_LABELS.map((_, i) => {
                    const month = i + 1;
                    const row = byYearMonth.get(`${year}-${month}`);
                    const val = row && row.active_lo_count > 0 ? row.active_units / row.active_lo_count : null;
                    return (
                      <TableCell
                        key={`${year}-${month}`}
                        className={`text-right ${selectedMonths.includes(month) ? "bg-sky-100 dark:bg-sky-900/40" : heatmapClass(val, monthHeatmapAvgs.p35LO, monthHeatmapAvgs.p65LO)}`}
                        onClick={() => widgetConfig.onToggleMonth?.(month)}
                      >
                        {row != null ? formatUnitsPerActor(row.active_units, row.active_lo_count) : '—'}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
              {years.map((year) => (
                <TableRow key={`upops-${year}`}>
                  <TableCell className="font-medium sticky left-0 bg-background z-10 text-muted-foreground">{year} Units per OPs</TableCell>
                  {MONTH_LABELS.map((_, i) => {
                    const month = i + 1;
                    const row = byYearMonth.get(`${year}-${month}`);
                    const val = row && row.active_ops_count > 0 ? row.active_units / row.active_ops_count : null;
                    return (
                      <TableCell
                        key={`${year}-${month}`}
                        className={`text-right ${selectedMonths.includes(month) ? "bg-sky-100 dark:bg-sky-900/40" : heatmapClass(val, monthHeatmapAvgs.p35OPs, monthHeatmapAvgs.p65OPs)}`}
                        onClick={() => widgetConfig.onToggleMonth?.(month)}
                      >
                        {row != null ? formatUnitsPerActor(row.active_units, row.active_ops_count) : '—'}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </WidgetShell>
    );
  }

  const { weekValues } = derived;

  return (
    <WidgetShell title="Active Pipeline Analysis – Table">
      <div className="h-full min-h-0 overflow-auto border rounded-md text-xs">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[100px] sticky left-0 bg-background z-10 font-semibold" />
              {weekValues.slice(0, 26).map((w) => (
                <TableHead
                  key={w}
                  className={`text-right whitespace-nowrap ${selectedWeekValues.includes(w) ? "bg-sky-100 dark:bg-sky-900/40" : ""}`}
                  onClick={() => widgetConfig.onToggleWeek?.(w)}
                >
                  {ordinal(w)} {snapshotDayLabel}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {years.map((year) => (
              <TableRow key={`vol-${year}`}>
                <TableCell className="font-medium sticky left-0 bg-background z-10">{year} Volume</TableCell>
                {weekValues.slice(0, 26).map((w) => {
                  const row = byYearWeek.get(`${year}-${w}`);
                  return (
                    <TableCell
                      key={`${year}-${w}`}
                      className={`text-right ${selectedWeekValues.includes(w) ? "bg-sky-100 dark:bg-sky-900/40" : ""}`}
                      onClick={() => widgetConfig.onToggleWeek?.(w)}
                    >
                      {row != null ? formatVolume(row.active_volume) : '—'}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
            {years.map((year) => (
              <TableRow key={`units-${year}`}>
                <TableCell className="font-medium sticky left-0 bg-background z-10">{year} Units</TableCell>
                {weekValues.slice(0, 26).map((w) => {
                  const row = byYearWeek.get(`${year}-${w}`);
                  return (
                    <TableCell
                      key={`${year}-${w}`}
                      className={`text-right ${selectedWeekValues.includes(w) ? "bg-sky-100 dark:bg-sky-900/40" : ""}`}
                      onClick={() => widgetConfig.onToggleWeek?.(w)}
                    >
                      {row != null ? row.active_units : '—'}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="font-medium sticky left-0 bg-background z-10 text-muted-foreground">
                Weekly % ({pctMetricLabel})
              </TableCell>
              {weekValues.slice(0, 26).map((w) => {
                const p = byWeekPct.get(w);
                const val = pctMetric === 'volume' ? p?.weeklyVolume : p?.weeklyUnits;
                return (
                  <TableCell
                    key={`w-${w}`}
                    className={`text-right ${selectedWeekValues.includes(w) ? "bg-sky-100 dark:bg-sky-900/40" : ""}`}
                    onClick={() => widgetConfig.onToggleWeek?.(w)}
                  >
                    {val != null ? formatPct(val) : '—'}
                  </TableCell>
                );
              })}
            </TableRow>
            <TableRow>
              <TableCell className="font-medium sticky left-0 bg-background z-10 text-muted-foreground">
                Monthly % ({pctMetricLabel})
              </TableCell>
              {weekValues.slice(0, 26).map((w) => {
                const p = byWeekPct.get(w);
                const val = pctMetric === 'volume' ? p?.monthlyVolume : p?.monthlyUnits;
                return (
                  <TableCell
                    key={`m-${w}`}
                    className={`text-right ${selectedWeekValues.includes(w) ? "bg-sky-100 dark:bg-sky-900/40" : ""}`}
                    onClick={() => widgetConfig.onToggleWeek?.(w)}
                  >
                    {val != null ? formatPct(val) : '—'}
                  </TableCell>
                );
              })}
            </TableRow>
            <TableRow>
              <TableCell className="font-medium sticky left-0 bg-background z-10 text-muted-foreground">
                Annual % ({pctMetricLabel})
              </TableCell>
              {weekValues.slice(0, 26).map((w) => {
                const p = byWeekPct.get(w);
                const val = pctMetric === 'volume' ? p?.annualVolume : p?.annualUnits;
                return (
                  <TableCell
                    key={`a-${w}`}
                    className={`text-right ${selectedWeekValues.includes(w) ? "bg-sky-100 dark:bg-sky-900/40" : ""}`}
                    onClick={() => widgetConfig.onToggleWeek?.(w)}
                  >
                    {val != null ? formatPct(val) : '—'}
                  </TableCell>
                );
              })}
            </TableRow>
            {years.map((year) => (
              <TableRow key={`lo-${year}`}>
                <TableCell className="font-medium sticky left-0 bg-background z-10">{year} LO Count</TableCell>
                {weekValues.slice(0, 26).map((w) => {
                  const row = byYearWeek.get(`${year}-${w}`);
                  return (
                    <TableCell
                      key={`${year}-${w}`}
                      className={`text-right ${selectedWeekValues.includes(w) ? "bg-sky-100 dark:bg-sky-900/40" : ""}`}
                      onClick={() => widgetConfig.onToggleWeek?.(w)}
                    >
                      {row != null ? row.active_lo_count : '—'}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
            {years.map((year) => (
              <TableRow key={`ops-${year}`}>
                <TableCell className="font-medium sticky left-0 bg-background z-10">{year} OPs Count</TableCell>
                {weekValues.slice(0, 26).map((w) => {
                  const row = byYearWeek.get(`${year}-${w}`);
                  return (
                    <TableCell
                      key={`${year}-${w}`}
                      className={`text-right ${selectedWeekValues.includes(w) ? "bg-sky-100 dark:bg-sky-900/40" : ""}`}
                      onClick={() => widgetConfig.onToggleWeek?.(w)}
                    >
                      {row != null ? row.active_ops_count : '—'}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
            {years.map((year) => (
              <TableRow key={`uplo-${year}`}>
                <TableCell className="font-medium sticky left-0 bg-background z-10 text-muted-foreground">{year} Units per LO</TableCell>
                {weekValues.slice(0, 26).map((w) => {
                  const row = byYearWeek.get(`${year}-${w}`);
                  const val = row && row.active_lo_count > 0 ? row.active_units / row.active_lo_count : null;
                  return (
                    <TableCell
                      key={`${year}-${w}`}
                      className={`text-right ${selectedWeekValues.includes(w) ? "bg-sky-100 dark:bg-sky-900/40" : heatmapClass(val, weekHeatmapAvgs.p35LO, weekHeatmapAvgs.p65LO)}`}
                      onClick={() => widgetConfig.onToggleWeek?.(w)}
                    >
                      {row != null ? formatUnitsPerActor(row.active_units, row.active_lo_count) : '—'}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
            {years.map((year) => (
              <TableRow key={`upops-${year}`}>
                <TableCell className="font-medium sticky left-0 bg-background z-10 text-muted-foreground">{year} Units per OPs</TableCell>
                {weekValues.slice(0, 26).map((w) => {
                  const row = byYearWeek.get(`${year}-${w}`);
                  const val = row && row.active_ops_count > 0 ? row.active_units / row.active_ops_count : null;
                  return (
                    <TableCell
                      key={`${year}-${w}`}
                      className={`text-right ${selectedWeekValues.includes(w) ? "bg-sky-100 dark:bg-sky-900/40" : heatmapClass(val, weekHeatmapAvgs.p35OPs, weekHeatmapAvgs.p65OPs)}`}
                      onClick={() => widgetConfig.onToggleWeek?.(w)}
                    >
                      {row != null ? formatUnitsPerActor(row.active_units, row.active_ops_count) : '—'}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </WidgetShell>
  );
}

// ---------------------------------------------------------------------------
// Volume & Units Chart Widget
// ---------------------------------------------------------------------------

export function PipelineAnalysisChartWidget({
  data,
  loading,
  error,
  width,
  height,
  config,
}: WidgetRenderProps<PipelineAnalysisSource>) {
  const derived = useMemo(() => buildDerived(data), [data]);
  const widgetConfig = (config ?? {}) as PipelineAnalysisWidgetConfig;

  if (loading) {
    return (
      <WidgetShell loading>
        <div className="flex items-center justify-center gap-2 text-slate-500 h-full">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      </WidgetShell>
    );
  }
  if (error) {
    return (
      <WidgetShell error={error}>
        <p className="text-sm text-destructive">{error}</p>
      </WidgetShell>
    );
  }
  if (!derived || derived.pipelineChartData.length === 0 || derived.years.length < 1) {
    return (
      <WidgetShell title="Pipeline Volume & Units">
        <div className="text-muted-foreground text-sm py-8 text-center">No data to display.</div>
      </WidgetShell>
    );
  }

  const {
    years,
    pipelineChartData,
    snapshotDayLabel,
    chartXKey,
    selectedWeekValues,
    selectedMonths,
  } = derived;
  const hasSelection = selectedWeekValues.length > 0 || selectedMonths.length > 0;
  const chartHeight = Math.max(280, (height ?? 300) - 48);

  return (
    <WidgetShell title="Total Pipeline Volume & Units">
      <div className="p-2 flex-1 min-h-0">
        <ResponsiveContainer width="100%" height={chartHeight}>
          <ComposedChart
            data={pipelineChartData}
            margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
            barCategoryGap="20%"
            barGap={2}
            onClick={(state: unknown) => {
              const s = state as { activePayload?: Array<{ payload?: { week?: number; month?: number } }> } | null;
              const point = s?.activePayload?.[0]?.payload;
              if (!point) return;
              if (point.week != null) widgetConfig.onToggleWeek?.(point.week);
              if (point.month != null) widgetConfig.onToggleMonth?.(point.month);
            }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
            <XAxis
              dataKey={chartXKey}
              tick={{ fontSize: 10 }}
              label={{ value: chartXKey === 'periodLabel' ? 'Month' : 'Week', position: 'insideBottom', offset: -6, fontSize: 11 }}
            />
            <YAxis
              yAxisId="units"
              orientation="left"
              width={44}
              tick={{ fontSize: 9 }}
              label={{ value: 'Units', angle: -90, position: 'insideLeft', fontSize: 10 }}
            />
            <YAxis
              yAxisId="volume"
              orientation="right"
              width={44}
              tick={{ fontSize: 9 }}
              tickFormatter={(v) =>
                v >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(v)
              }
              label={{ value: 'Volume', angle: 90, position: 'insideRight', fontSize: 10 }}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0]?.payload;
                if (!p) return null;
                const title = chartXKey === 'periodLabel' ? (p.periodLabel as string) : `${p.weekLabel} ${snapshotDayLabel}`;
                return (
                  <div className="rounded-lg border border-border bg-background px-2 py-1.5 shadow-md text-xs">
                    <p className="font-medium mb-1">{title}</p>
                    {years.map((y) => (
                      <div key={y} className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                        <span className="text-muted-foreground">{y} Volume</span>
                        <span className="tabular-nums">
                          {p[`${y} Volume`] != null ? formatVolume(p[`${y} Volume`] as number) : '—'}
                        </span>
                        <span className="text-muted-foreground">{y} Units</span>
                        <span className="tabular-nums">{p[`${y} Units`] != null ? String(p[`${y} Units`]) : '—'}</span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ paddingTop: 4 }} formatter={(v) => v} iconType="rect" iconSize={8} />
            {years.map((y, i) => (
              <Bar
                key={`${y}-units`}
                yAxisId="units"
                dataKey={`${y} Units`}
                name={`${y} Units`}
                fill={i === 0 ? '#00008f' : '#52b852'}
                radius={[2, 2, 0, 0]}
                className="cursor-pointer"
              >
                {pipelineChartData.map((point, idx) => {
                  const p = point as { week?: number; month?: number };
                  const selected = p.week != null
                    ? selectedWeekValues.includes(p.week)
                    : p.month != null
                      ? selectedMonths.includes(p.month)
                      : false;
                  const fill = selected
                    ? "#0ea5e9"
                    : i === 0
                        ? "#00008f"
                        : "#52b852";
                  return <Cell key={`${y}-units-cell-${idx}`} fill={fill} />;
                })}
              </Bar>
            ))}
            {years.map((y, i) => (
              <Line
                key={`${y}-volume`}
                yAxisId="volume"
                type="monotone"
                dataKey={`${y} Volume`}
                name={`${y} Volume`}
                stroke={i === 0 ? '#8080c7' : '#a9dca9'}
                strokeWidth={1.5}
                dot={(props) => {
                  const p = props as { cx?: number; cy?: number; payload?: { week?: number; month?: number } };
                  const week = p.payload?.week;
                  const month = p.payload?.month;
                  const selected = week != null
                    ? selectedWeekValues.includes(week)
                    : month != null
                      ? selectedMonths.includes(month)
                      : false;
                  const dimmed = hasSelection && !selected;
                  return (
                    <circle
                      cx={p.cx}
                      cy={p.cy}
                      r={2.5}
                      fill={selected ? "#7dd3fc" : dimmed ? "#cbd5e1" : i === 0 ? "#8080c7" : "#a9dca9"}
                    />
                  );
                }}
                connectNulls
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </WidgetShell>
  );
}

// ---------------------------------------------------------------------------
// LO Count Chart Widget
// ---------------------------------------------------------------------------

export function PipelineAnalysisLOCountWidget({
  data,
  loading,
  error,
  width,
  height,
  config,
}: WidgetRenderProps<PipelineAnalysisSource>) {
  const derived = useMemo(() => buildDerived(data), [data]);
  const widgetConfig = (config ?? {}) as PipelineAnalysisWidgetConfig;

  if (loading) {
    return (
      <WidgetShell loading>
        <div className="flex items-center justify-center gap-2 text-slate-500 h-full">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      </WidgetShell>
    );
  }
  if (error) {
    return (
      <WidgetShell error={error}>
        <p className="text-sm text-destructive">{error}</p>
      </WidgetShell>
    );
  }
  if (!derived || derived.pipelineLoCountChartData.length === 0 || derived.years.length < 1) {
    return (
      <WidgetShell title="LO Count">
        <div className="text-muted-foreground text-sm py-8 text-center">No data to display.</div>
      </WidgetShell>
    );
  }

  const {
    years,
    pipelineLoCountChartData,
    snapshotDayLabel,
    chartXKey,
    selectedWeekValues,
    selectedMonths,
  } = derived;
  const hasSelection = selectedWeekValues.length > 0 || selectedMonths.length > 0;
  const chartHeight = Math.max(280, (height ?? 300) - 48);

  return (
    <WidgetShell title="LO Count by Week">
      <div className="p-2 flex-1 min-h-0">
        <ResponsiveContainer width="100%" height={chartHeight}>
          <ComposedChart
            data={pipelineLoCountChartData}
            margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
            barCategoryGap="20%"
            barGap={2}
            onClick={(state: unknown) => {
              const s = state as { activePayload?: Array<{ payload?: { week?: number; month?: number } }> } | null;
              const point = s?.activePayload?.[0]?.payload;
              if (!point) return;
              if (point.week != null) widgetConfig.onToggleWeek?.(point.week);
              if (point.month != null) widgetConfig.onToggleMonth?.(point.month);
            }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
            <XAxis
              dataKey={chartXKey}
              tick={{ fontSize: 10 }}
              label={{ value: chartXKey === 'periodLabel' ? 'Month' : 'Week', position: 'insideBottom', offset: -6, fontSize: 11 }}
            />
            <YAxis
              yAxisId="loCount"
              width={36}
              allowDecimals={false}
              tick={{ fontSize: 9 }}
              label={{ value: 'LO Count', angle: -90, position: 'insideLeft', fontSize: 10 }}
            />
            <YAxis
              yAxisId="units"
              orientation="right"
              width={36}
              allowDecimals={false}
              tick={{ fontSize: 9 }}
              label={{ value: 'Units', angle: 90, position: 'insideRight', fontSize: 10 }}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0]?.payload;
                if (!p) return null;
                const title = chartXKey === 'periodLabel' ? (p.periodLabel as string) : `${p.weekLabel} ${snapshotDayLabel}`;
                return (
                  <div className="rounded-lg border border-border bg-background px-2 py-1.5 shadow-md text-xs">
                    <p className="font-medium mb-1">{title}</p>
                    {years.map((y) => (
                      <div key={y} className="space-y-0.5">
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">{y} LO Count</span>
                          <span className="font-medium tabular-nums">
                            {p[`${y} LO Count`] != null ? String(p[`${y} LO Count`]) : '—'}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">{y} Units</span>
                          <span className="font-medium tabular-nums">
                            {p[`${y} Units`] != null ? String(p[`${y} Units`]) : '—'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ paddingTop: 4 }} formatter={(v) => v} iconType="rect" iconSize={8} />
            {years.map((y, i) => (
              <Bar
                key={`${y}-lo`}
                yAxisId="loCount"
                dataKey={`${y} LO Count`}
                name={`${y} LO Count`}
                fill={i === 0 ? '#00008f' : '#52b852'}
                radius={[2, 2, 0, 0]}
                className="cursor-pointer"
              >
                {pipelineLoCountChartData.map((point, idx) => {
                  const p = point as { week?: number; month?: number };
                  const selected = p.week != null
                    ? selectedWeekValues.includes(p.week)
                    : p.month != null
                      ? selectedMonths.includes(p.month)
                      : false;
                  const fill = selected
                    ? "#0ea5e9"
                    : i === 0
                        ? "#00008f"
                        : "#52b852";
                  return <Cell key={`${y}-lo-cell-${idx}`} fill={fill} />;
                })}
              </Bar>
            ))}
            {years.map((y, i) => (
              <Line
                key={`${y}-units`}
                yAxisId="units"
                type="monotone"
                dataKey={`${y} Units`}
                name={`${y} Units`}
                stroke={i === 0 ? '#8080c7' : '#a9dca9'}
                strokeWidth={1.5}
                dot={(props) => {
                  const p = props as { cx?: number; cy?: number; payload?: { week?: number; month?: number } };
                  const week = p.payload?.week;
                  const month = p.payload?.month;
                  const selected = week != null
                    ? selectedWeekValues.includes(week)
                    : month != null
                      ? selectedMonths.includes(month)
                      : false;
                  const dimmed = hasSelection && !selected;
                  return (
                    <circle
                      cx={p.cx}
                      cy={p.cy}
                      r={2.5}
                      fill={selected ? "#7dd3fc" : dimmed ? "#cbd5e1" : i === 0 ? "#8080c7" : "#a9dca9"}
                    />
                  );
                }}
                connectNulls
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </WidgetShell>
  );
}
