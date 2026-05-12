/**
 * Lock Stratification Dashboard View
 * Filters, KPIs, interest rate distribution, milestone chart/pivot,
 * days-to-lock-expiration table, and pull-through analysis.
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTheme } from "@/components/theme-provider";
import { useWidgetSectionStore } from "@/stores/widgetSectionStore";
import {
  useLockStratificationData,
  type LockStratFilters,
  type LockedFilter,
  type MeasureFilter,
  type MilestoneGroupBy,
  type PullThroughPeriod,
  type InterestRateDrill,
} from "@/hooks/useLockStratificationData";
import { useDashboardFilterAnalytics } from "@/hooks/useDashboardFilterAnalytics";
import { DASHBOARD_PAGE_KEYS } from "@/lib/dashboardPageKeys";
import { Loader2, ChevronRight, Download, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

// ── Filter Options ──

const LOCKED_OPTIONS: { value: LockedFilter; label: string }[] = [
  { value: "active_locked", label: "Active Locked" },
  { value: "active_not_locked", label: "Active NOT Locked" },
  { value: "all_active", label: "All Active Loans" },
];

const MEASURE_OPTIONS: { value: MeasureFilter; label: string }[] = [
  { value: "volume", label: "Volume" },
  { value: "units", label: "Units" },
  { value: "wac", label: "WAC" },
  { value: "wa_fico", label: "WA FICO" },
];

const MILESTONE_GROUP_OPTIONS: { value: MilestoneGroupBy; label: string }[] = [
  { value: "current_milestone", label: "Current Milestone" },
  { value: "investor", label: "Investor" },
  { value: "branch", label: "Branch" },
  { value: "broker_lender", label: "Broker Lender" },
  { value: "lo", label: "Loan Officer" },
  { value: "ae", label: "Account Executive" },
];

const PULL_THROUGH_PERIODS: { value: PullThroughPeriod; label: string }[] = [
  { value: "30", label: "30 Days" },
  { value: "60", label: "60 Days" },
  { value: "90", label: "90 Days" },
  { value: "120", label: "120 Days" },
  { value: "ytd", label: "Year to Date" },
];

const EXPIRATION_BUCKETS = ["1-7 Days", "8-14 Days", "15-21 Days", "22-30 Days", ">30 Days", "Expired", "Lock Expiration Date Blank"];
const BUCKET_COLORS = ["#f59e0b", "#164e63", "#0891b2", "#22d3ee", "#67e8f9", "#991b1b", "#6b7280"];

const MILESTONE_ORDER = [
  "Disclosure Prep",
  "Scrubbed",
  "Processing",
  "Submittal",
  "Cond. Approval",
  "Resubmittal",
  "Approval",
  "Ready for Docs",
  "Closer Assignment",
  "Docs Out",
];

// ── KPI Tooltip Descriptions ──

const KPI_TOOLTIPS: Record<string, string> = {
  wac: "Excludes Interest Rate outliers < 0 OR > 15 are excluded",
  waFico: "Excludes FICO Score outliers < 350 OR > 900 are excluded",
  waLtv: "Excludes LTV Ratio outliers < 0 OR > 110 are excluded",
  waDti: "Excludes BE DTI Ratio outliers < -8 OR > 78 are excluded",
};

// ── Formatters ──

function formatCurrency(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatNum(n: number, decimals = 0): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return formatNum(n);
}

/** CSV helpers */
function csvEscape(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n") || val.includes("\r")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Persistence ──

const FILTERS_KEY = "cohi-lock-stratification-filters";

interface PersistedFilters {
  locked?: LockedFilter;
  measure?: MeasureFilter;
  milestoneGroupBy?: MilestoneGroupBy;
  milestoneView?: "bar" | "pivot";
  pullThroughPeriod?: PullThroughPeriod;
  interestRateDrill?: InterestRateDrill;
  selectedExpirationBucket?: string | null;
  selectedMilestoneGroup?: string | null;
}

function loadFilters(): Partial<PersistedFilters> {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<PersistedFilters>;
  } catch {
    return {};
  }
}

function saveFilters(f: PersistedFilters): void {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(f));
  } catch { /* ignore */ }
}

// ── Component Props ──

export type LockStratificationVariant =
  | "full"
  | "kpis"
  | "interest-rates"
  | "days-to-expiration"
  | "pull-through"
  | "milestone-bar"
  | "milestone-pivot";

export interface LockStratificationViewProps {
  tenantId?: string | null;
  selectedChannel?: string | null;
  /** When true, view is embedded in workbench (e.g. filter bar is in group header). */
  embeddedInWorkbench?: boolean;
  /** Section/group ID to read filters from widgetSectionStore. When set, locked/measure/milestoneGroupBy/pullThroughPeriod come from store. */
  groupId?: string | null;
  /** When set, only render this section (for workbench widgets). */
  variant?: LockStratificationVariant;
  /** When embedded in workbench, the widget cell height in pixels so content can fill it. */
  embedHeight?: number;
  /** When embedded in workbench, the widget cell width in pixels. */
  embedWidth?: number;
  /** Callback to report rendered data for PPT export / canvasDataStore */
  onDataReady?: (data: unknown) => void;
}

export function LockStratificationView({
  tenantId,
  selectedChannel,
  embeddedInWorkbench = false,
  groupId = null,
  variant = "full",
  embedHeight,
  embedWidth,
  onDataReady,
}: LockStratificationViewProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const getFilters = useWidgetSectionStore((s) => s.getFilters);
  const updateFilters = useWidgetSectionStore((s) => s.updateFilters);

  const saved = useMemo(() => loadFilters(), []);
  const groupFilters = groupId ? getFilters(groupId) : null;

  const [localLocked, setLocalLocked] = useState<LockedFilter>(saved.locked ?? "all_active");
  const [localMeasure, setLocalMeasure] = useState<MeasureFilter>(saved.measure ?? "volume");
  const [localMilestoneGroupBy, setLocalMilestoneGroupBy] = useState<MilestoneGroupBy>(() => {
    const v = saved.milestoneGroupBy;
    if (v && MILESTONE_GROUP_OPTIONS.some((o) => o.value === v)) return v;
    return "current_milestone";
  });
  const [milestoneView, setMilestoneView] = useState<"bar" | "pivot">(saved.milestoneView ?? "bar");
  const [localPullThroughPeriod, setLocalPullThroughPeriod] = useState<PullThroughPeriod>(saved.pullThroughPeriod ?? "60");
  const [expandedPivotRows, setExpandedPivotRows] = useState<Set<string>>(new Set());
  const [localInterestRateDrill, setLocalInterestRateDrill] = useState<InterestRateDrill>(() => saved.interestRateDrill ?? { level: 0 });
  const [localSelectedExpirationBucket, setLocalSelectedExpirationBucket] = useState<string | null>(saved.selectedExpirationBucket ?? null);
  const [localSelectedMilestoneGroup, setLocalSelectedMilestoneGroup] = useState<string | null>(saved.selectedMilestoneGroup ?? null);
  const didInitMilestoneGroupRef = useRef(false);

  const locked = (groupFilters?.lockStratLocked as LockedFilter) ?? localLocked;
  const measure = (groupFilters?.lockStratMeasure as MeasureFilter) ?? localMeasure;
  const milestoneGroupBy = (groupFilters?.lockStratMilestoneGroupBy as MilestoneGroupBy) ?? localMilestoneGroupBy;
  const pullThroughPeriod = (groupFilters?.lockStratPullThroughPeriod as PullThroughPeriod) ?? localPullThroughPeriod;
  const selectedExpirationBucket =
    (groupFilters?.lockStratSelectedExpirationBucket as string | null | undefined) ??
    localSelectedExpirationBucket;
  const selectedMilestoneGroup =
    (groupFilters?.lockStratSelectedMilestoneGroup as string | null | undefined) ??
    localSelectedMilestoneGroup;
  const interestRateDrill =
    (groupFilters?.lockStratSelectedInterestRateGroup as InterestRateDrill | undefined) ??
    localInterestRateDrill;
  const setInterestRateDrill = useCallback((next: InterestRateDrill) => {
    if (groupId) {
      updateFilters(groupId, { lockStratSelectedInterestRateGroup: next });
      return;
    }
    setLocalInterestRateDrill(next);
  }, [groupId, updateFilters]);
  const setSelectedExpirationBucket = useCallback((next: string | null) => {
    if (groupId) {
      updateFilters(groupId, { lockStratSelectedExpirationBucket: next });
      return;
    }
    setLocalSelectedExpirationBucket(next);
  }, [groupId, updateFilters]);
  const setSelectedMilestoneGroup = useCallback((next: string | null) => {
    if (groupId) {
      updateFilters(groupId, { lockStratSelectedMilestoneGroup: next });
      return;
    }
    setLocalSelectedMilestoneGroup(next);
  }, [groupId, updateFilters]);

  useEffect(() => {
    if (!groupId) {
      saveFilters({
        locked: localLocked,
        measure: localMeasure,
        milestoneGroupBy: localMilestoneGroupBy,
        milestoneView,
        pullThroughPeriod: localPullThroughPeriod,
        interestRateDrill: localInterestRateDrill,
        selectedExpirationBucket: localSelectedExpirationBucket,
        selectedMilestoneGroup: localSelectedMilestoneGroup,
      });
    }
  }, [
    groupId,
    localLocked,
    localMeasure,
    localMilestoneGroupBy,
    milestoneView,
    localPullThroughPeriod,
    localInterestRateDrill,
    localSelectedExpirationBucket,
    localSelectedMilestoneGroup,
  ]);

  const filters: LockStratFilters = useMemo(() => ({ locked, measure }), [locked, measure]);

  const filterAnalyticsSnapshot = useMemo(
    () => ({
      locked,
      measure,
      milestoneGroupBy,
      milestoneView,
      pullThroughPeriod,
      interest_rate_drill_level: interestRateDrill.level,
      interest_rate_drill_min: interestRateDrill.min ?? null,
      interest_rate_drill_max: interestRateDrill.max ?? null,
      selectedExpirationBucket,
      selectedMilestoneGroup,
      selectedChannel: selectedChannel ?? "All",
    }),
    [
      locked,
      measure,
      milestoneGroupBy,
      milestoneView,
      pullThroughPeriod,
      interestRateDrill.level,
      interestRateDrill.min,
      interestRateDrill.max,
      selectedExpirationBucket,
      selectedMilestoneGroup,
      selectedChannel,
    ]
  );
  useDashboardFilterAnalytics(DASHBOARD_PAGE_KEYS.lock_stratification, filterAnalyticsSnapshot, {
    enabled: !embeddedInWorkbench,
  });

  const {
    kpis,
    interestRates,
    milestoneChart,
    milestonePivot,
    daysToExpiration,
    pullThrough,
    loading,
    error,
  } = useLockStratificationData(filters, {
    tenantId,
    selectedChannel,
    milestoneGroupBy,
    pullThroughPeriod,
    interestRateDrill,
    expirationBucket: selectedExpirationBucket,
    selectedGroupBy: selectedMilestoneGroup ? milestoneGroupBy : null,
    selectedGroupValue: selectedMilestoneGroup,
  });

  // Report data to canvasDataStore for PPT export
  useEffect(() => {
    if (!onDataReady || loading) return;
    if (variant === 'kpis' && kpis) {
      onDataReady({ variant: 'kpis', ...kpis });
    } else if (variant === 'interest-rates' && interestRates && interestRates.length > 0) {
      onDataReady({
        chartType: 'bar',
        xAxisKey: 'bucket',
        series: [{ dataKey: 'value', color: '#3b82f6' }],
        data: interestRates,
        title: 'Interest Rate Distribution',
      });
    } else if (variant === 'days-to-expiration' && daysToExpiration && daysToExpiration.length > 0) {
      onDataReady({
        columns: [
          { key: 'bucket', label: 'Days to Expiration' },
          { key: 'units', label: 'Units' },
          { key: 'volume', label: 'Volume' },
          { key: 'wac', label: 'WAC' },
          { key: 'avgDaysActive', label: 'Avg Days Active' },
        ],
        rows: daysToExpiration,
      });
    } else if (variant === 'pull-through' && pullThrough) {
      onDataReady({
        chartType: 'bar',
        xAxisKey: 'month',
        series: [
          { dataKey: 'originated_pct', color: '#10b981' },
          { dataKey: 'withdrawn_pct', color: '#f59e0b' },
          { dataKey: 'denied_pct', color: '#ef4444' },
        ],
        data: pullThrough.bars || [],
        title: 'Pull Through Analysis',
      });
    } else if ((variant === 'milestone-bar' || variant === 'milestone-pivot') && milestoneChart && milestoneChart.length > 0) {
      onDataReady({
        chartType: 'bar',
        xAxisKey: 'group',
        series: [{ dataKey: 'value', color: '#6366f1' }],
        data: milestoneChart,
        title: 'Active Loans by Milestone',
      });
    }
  }, [onDataReady, loading, variant, kpis, interestRates, daysToExpiration, pullThrough, milestoneChart]);

  const labelPrefix = kpis?.labelPrefix ?? "All Active";

  /** Parse bucket label "X.XXX - Y.YYY" or "X.XXXX" (rate) into [min, max]. Returns null if not parseable. */
  const parseBucketRange = useCallback((bucket: string): [number, number] | null => {
    const rangeMatch = /^([\d.]+)\s*-\s*([\d.]+)$/.exec(bucket.trim());
    if (rangeMatch) {
      const a = Number(rangeMatch[1]);
      const b = Number(rangeMatch[2]);
      if (Number.isFinite(a) && Number.isFinite(b) && a < b) return [a, b];
    }
    const single = Number(bucket.trim());
    if (Number.isFinite(single)) return [single, single];
    return null;
  }, []);

  const handleInterestRateBarClick = useCallback(
    (data: { bucket: string }) => {
      const range = parseBucketRange(data.bucket);
      if (!range) return;
      const [min, max] = range;
      if (interestRateDrill.level === 0) {
        setInterestRateDrill({ level: 1, min, max });
      } else if (interestRateDrill.level === 1) {
        setInterestRateDrill({ level: 2, min, max });
      }
    },
    [interestRateDrill.level, parseBucketRange, setInterestRateDrill]
  );

  const toggleExpirationBucketFilter = useCallback((bucket: string) => {
    setSelectedExpirationBucket((selectedExpirationBucket ?? null) === bucket ? null : bucket);
  }, [selectedExpirationBucket, setSelectedExpirationBucket]);
  const toggleMilestoneGroupFilter = useCallback((groupName: string) => {
    setSelectedMilestoneGroup((selectedMilestoneGroup ?? null) === groupName ? null : groupName);
  }, [selectedMilestoneGroup, setSelectedMilestoneGroup]);
  const clearAllDrillFilters = useCallback(() => {
    setInterestRateDrill({ level: 0 });
    setSelectedExpirationBucket(null);
    setSelectedMilestoneGroup(null);
  }, [setInterestRateDrill, setSelectedExpirationBucket, setSelectedMilestoneGroup]);

  const interestRateFilterLabel = useMemo(() => {
    if (interestRateDrill.level === 0) return null;
    const { min, max } = interestRateDrill;
    if (min === max) return `Rate: ${min.toFixed(4)}`;
    return `Rate: ${min.toFixed(3)} – ${max.toFixed(3)}`;
  }, [interestRateDrill]);
  const groupDimensionLabel = useMemo(
    () => MILESTONE_GROUP_OPTIONS.find((o) => o.value === milestoneGroupBy)?.label ?? "Group",
    [milestoneGroupBy],
  );
  const activeFilterLabels = useMemo(() => {
    const labels: { key: string; text: string; onClear: () => void }[] = [];
    if (interestRateFilterLabel) {
      labels.push({
        key: "interest-rate",
        text: interestRateFilterLabel,
        onClear: () => setInterestRateDrill({ level: 0 }),
      });
    }
    if (selectedExpirationBucket) {
      labels.push({
        key: "expiration-bucket",
        text: `Days to Expiration: ${selectedExpirationBucket}`,
        onClear: () => setSelectedExpirationBucket(null),
      });
    }
    if (selectedMilestoneGroup) {
      labels.push({
        key: "milestone-group",
        text: `${groupDimensionLabel}: ${selectedMilestoneGroup}`,
        onClear: () => setSelectedMilestoneGroup(null),
      });
    }
    return labels;
  }, [
    groupDimensionLabel,
    interestRateFilterLabel,
    selectedExpirationBucket,
    selectedMilestoneGroup,
    setInterestRateDrill,
    setSelectedExpirationBucket,
    setSelectedMilestoneGroup,
  ]);

  useEffect(() => {
    if (!didInitMilestoneGroupRef.current) {
      didInitMilestoneGroupRef.current = true;
      return;
    }
    setSelectedMilestoneGroup(null);
  }, [milestoneGroupBy, setSelectedMilestoneGroup]);

  const displayError =
    error != null
      ? error.includes("No tenant selected") || error.includes("Tenant context required")
        ? "Select a tenant to view data."
        : error
      : null;

  // ── Milestone bar chart data transform (flat rows, one bar per bucket) ──
  // When group_by is current_milestone, use pivot rows so chart shows same milestones as pivot (dashboard parity).
  const milestoneBarData = useMemo(() => {
    const groupMap = new Map<string, Map<string, number>>();
    for (const row of milestoneChart) {
      if (milestoneGroupBy === "current_milestone") {
        const matchIdx = MILESTONE_ORDER.findIndex(
          (m) => m.toLowerCase() === row.group.toLowerCase()
        );
        if (matchIdx === -1) continue;
      }
      const key = row.group;
      if (!groupMap.has(key)) groupMap.set(key, new Map());
      const g = groupMap.get(key)!;
      g.set(row.expirationBucket, (g.get(row.expirationBucket) || 0) + row.value);
    }

    let orderedGroups: string[];
    if (milestoneGroupBy === "current_milestone") {
      const fromPivot = milestonePivot.rows
        .filter((r) => MILESTONE_ORDER.some((m) => m.toLowerCase() === r.group.toLowerCase()))
        .sort((a, b) => {
          const aIdx = MILESTONE_ORDER.findIndex((m) => m.toLowerCase() === a.group.toLowerCase());
          const bIdx = MILESTONE_ORDER.findIndex((m) => m.toLowerCase() === b.group.toLowerCase());
          return aIdx - bIdx;
        })
        .map((r) => r.group);
      const fromChart = MILESTONE_ORDER.filter((m) =>
        [...groupMap.keys()].some((k) => k.toLowerCase() === m.toLowerCase())
      ).map((m) => [...groupMap.keys()].find((k) => k.toLowerCase() === m.toLowerCase())!);
      orderedGroups = fromPivot.length > 0 ? fromPivot : fromChart;
    } else {
      orderedGroups = [...groupMap.keys()];
    }

    const flat: { compositeKey: string; group: string; bucket: string; value: number; bucketIdx: number; isFirstInGroup: boolean }[] = [];
    for (const group of orderedGroups) {
      const canonicalKey = [...groupMap.keys()].find((k) => k.toLowerCase() === group.toLowerCase());
      const bucketMap = (canonicalKey ? groupMap.get(canonicalKey) : null) ?? new Map<string, number>();
      const bucketsToShow = bucketMap.size > 0
        ? [...bucketMap.entries()].sort((a, b) => {
            const aIdx = EXPIRATION_BUCKETS.indexOf(a[0]);
            const bIdx = EXPIRATION_BUCKETS.indexOf(b[0]);
            return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
          })
        : EXPIRATION_BUCKETS.map((b) => [b, 0] as [string, number]);
      bucketsToShow.forEach(([bucket, value], i) => {
        flat.push({
          compositeKey: `${group}||${bucket}`,
          group,
          bucket,
          value,
          bucketIdx: EXPIRATION_BUCKETS.indexOf(bucket),
          isFirstInGroup: i === 0,
        });
      });
    }
    return flat;
  }, [milestoneChart, milestoneGroupBy, milestonePivot.rows]);
  // ── Pivot rows filtered/sorted for current_milestone ──
  const sortedPivotRows = useMemo(() => {
    if (milestoneGroupBy !== "current_milestone") return milestonePivot.rows;
    const filtered = milestonePivot.rows.filter((r) =>
      MILESTONE_ORDER.some((m) => m.toLowerCase() === r.group.toLowerCase())
    );
    return filtered.sort((a, b) => {
      const aIdx = MILESTONE_ORDER.findIndex((m) => m.toLowerCase() === a.group.toLowerCase());
      const bIdx = MILESTONE_ORDER.findIndex((m) => m.toLowerCase() === b.group.toLowerCase());
      return aIdx - bIdx;
    });
  }, [milestonePivot.rows, milestoneGroupBy]);

  const renderMilestoneYAxisTick = useCallback(
    (props: Record<string, unknown>) => {
      const { x, y, payload } = props as { x: number; y: number; payload: { value: string } };
      const key = payload?.value ?? "";
      const parts = key.split("||");
      const row = milestoneBarData.find((r) => r.compositeKey === key);
      const groupLabel = row?.isFirstInGroup ? parts[0] : "";
      const bucketLabel = parts[1] || "";
      const groupForFilter = row?.group ?? parts[0];
      return (
        <g transform={`translate(${x},${y})`}>
          {groupLabel ? (
            <foreignObject x={-240} y={-18} width={130} height={36}>
              <div
                xmlns="http://www.w3.org/1999/xhtml"
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: isDark ? "#e2e8f0" : "#334155",
                  lineHeight: "1.25",
                  textAlign: "left",
                  overflow: "hidden",
                  wordWrap: "break-word",
                  cursor: "pointer",
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleMilestoneGroupFilter(groupForFilter);
                }}
                title={`Filter ${groupForFilter}`}
              >
                {groupLabel}
              </div>
            </foreignObject>
          ) : null}
          <text x={-5} y={0} dy={4} textAnchor="end" fontSize={10} fill={isDark ? "#94a3b8" : "#64748b"}>
            {bucketLabel}
          </text>
        </g>
      );
    },
    [milestoneBarData, isDark, toggleMilestoneGroupFilter],
  );

  // ── Interest rate color scale ──
  const rateColorScale = useMemo(() => {
    if (interestRates.length === 0) return () => isDark ? "#3b82f6" : "#3b82f6";
    const maxVal = Math.max(...interestRates.map((r) => r.value), 1);
    return (val: number) => {
      const ratio = Math.min(val / maxVal, 1);
      const lightness = isDark
        ? Math.round(60 - ratio * 30)
        : Math.round(80 - ratio * 50);
      return `hsl(210, 70%, ${lightness}%)`;
    };
  }, [interestRates, isDark]);

  // ── Pivot table toggle ──
  const togglePivotRow = useCallback((group: string) => {
    setExpandedPivotRows((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);

  // ── CSV Exports ──
  const handleExportPivot = useCallback(() => {
    const lines: string[] = ["Group,Expiration Bucket,Units,Volume,Percent"];
    const totalUnits = milestonePivot.totals.units;
    const totalVolume = milestonePivot.totals.volume;
    lines.push(`Total,,${totalUnits},${totalVolume},100.0%`);
    for (const row of sortedPivotRows) {
      lines.push(`${csvEscape(row.group)},,${row.units},${row.volume},${row.pct.toFixed(1)}%`);
      for (const child of row.children) {
        lines.push(`,${csvEscape(child.bucket)},${child.units},${child.volume},${child.pct.toFixed(1)}%`);
      }
    }
    downloadCsv(lines.join("\r\n"), "lock-stratification-milestone-pivot.csv");
  }, [milestonePivot]);

  const handleExportDaysToExpiration = useCallback(() => {
    const lines: string[] = ["Time Range,Units,Volume,WAC,Avg Days Active"];
    const totals = daysToExpiration.reduce(
      (acc, r) => ({
        units: acc.units + r.units,
        volume: acc.volume + r.volume,
      }),
      { units: 0, volume: 0 }
    );
    lines.push(`Total,${totals.units},${totals.volume.toFixed(2)},,`);
    for (const row of daysToExpiration) {
      lines.push(`${csvEscape(row.bucket)},${row.units},${row.volume.toFixed(2)},${row.wac.toFixed(3)},${row.avgDaysActive.toFixed(0)}`);
    }
    downloadCsv(lines.join("\r\n"), "lock-stratification-days-to-expiration.csv");
  }, [daysToExpiration]);

  // ── Theme classes ──
  const borderTh = isDark ? "border-slate-700" : "border-slate-200";
  const bgTh = isDark ? "bg-slate-800/50 text-slate-300" : "bg-slate-50 text-slate-600";
  const borderRow = isDark ? "border-slate-700" : "border-slate-100";
  const textTd = isDark ? "text-slate-200" : "text-slate-900";

  /** When embedded in workbench, we use flex layout so content fills the widget (no fixed height). */
  const isEmbedded = typeof embedHeight === "number";

  // ── KPI Card helper ──
  const kpiCard = (
    label: string,
    value: string,
    tooltipKey: string,
    accentColor: string,
    accentDark: string,
    accentLight: string,
    blurColor: string,
    blurColorDark: string
  ) => (
    <Card
      className={cn(
        "rounded-xl backdrop-blur-sm overflow-hidden transition-all duration-300 hover:shadow-lg",
        isDark
          ? `border-slate-700/50 bg-gradient-to-br ${accentDark} hover:border-${accentColor}-600/50`
          : `border-${accentColor}-200/40 bg-gradient-to-br ${accentLight} hover:border-${accentColor}-400/50 hover:shadow-${accentColor}-200/50`
      )}
    >
      <CardContent className="pt-4 pb-4 relative">
        <div className="flex items-center gap-1 mb-1">
          <p className={cn("text-[10px] font-semibold uppercase tracking-wider", isDark ? "text-slate-400" : "text-slate-600")}>
            {label}
          </p>
          {KPI_TOOLTIPS[tooltipKey] ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex cursor-help" tabIndex={0}>
                  <Info className="h-3 w-3 text-slate-400" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                {KPI_TOOLTIPS[tooltipKey]}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        <p className={cn("text-2xl font-bold tracking-tight", isDark ? "text-white" : "text-slate-900")}>
          {value}
        </p>
        <div className={cn("absolute top-0 right-0 w-16 h-16 rounded-full blur-2xl opacity-20", isDark ? blurColorDark : blurColor)} />
      </CardContent>
    </Card>
  );

  return (
    <div
      className={variant !== "full" ? "flex flex-col min-h-0 overflow-hidden" : "space-y-4"}
      style={isEmbedded && variant !== "full" ? { height: embedHeight } : undefined}
    >
      {displayError && (
        <p className="text-sm text-red-600 dark:text-red-400">{displayError}</p>
      )}

      {/* Single-variant rendering for workbench widgets */}
      {variant === "kpis" && (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          {loading && !kpis ? (
            [...Array(8)].map((_, i) => (
              <Card key={i} className={cn("rounded-xl border", isDark ? "border-slate-700 bg-slate-800/50" : "border-slate-200/60 bg-white")}>
                <CardContent className="pt-6 flex items-center justify-center h-20">
                  <Loader2 className="h-6 w-6 animate-spin text-sky-500" />
                </CardContent>
              </Card>
            ))
          ) : (
            <>
              {kpiCard(`${labelPrefix} Volume`, kpis ? formatCurrency(kpis.volume) : "—", "volume", "blue", "from-blue-900/20 via-slate-800/70 to-slate-800/70", "from-blue-50 via-white to-white", "bg-blue-300", "bg-blue-500")}
              {kpiCard(`${labelPrefix} Units`, kpis ? formatNum(kpis.units) : "—", "units", "purple", "from-purple-900/20 via-slate-800/70 to-slate-800/70", "from-purple-50 via-white to-white", "bg-purple-300", "bg-purple-500")}
              {kpiCard("Average Balance", kpis ? formatCurrency(kpis.avgBalance) : "—", "avgBalance", "amber", "from-amber-900/20 via-slate-800/70 to-slate-800/70", "from-amber-50 via-white to-white", "bg-amber-300", "bg-amber-500")}
              {kpiCard("Avg Days Active", kpis ? formatNum(kpis.avgDaysActive) : "—", "avgDaysActive", "emerald", "from-emerald-900/20 via-slate-800/70 to-slate-800/70", "from-emerald-50 via-white to-white", "bg-emerald-300", "bg-emerald-500")}
              {kpiCard("WAC", kpis ? formatNum(kpis.wac, 3) : "—", "wac", "sky", "from-sky-900/20 via-slate-800/70 to-slate-800/70", "from-sky-50 via-white to-white", "bg-sky-300", "bg-sky-500")}
              {kpiCard("WA FICO", kpis ? formatNum(kpis.waFico) : "—", "waFico", "indigo", "from-indigo-900/20 via-slate-800/70 to-slate-800/70", "from-indigo-50 via-white to-white", "bg-indigo-300", "bg-indigo-500")}
              {kpiCard("WA LTV", kpis ? `${formatNum(kpis.waLtv, 1)}` : "—", "waLtv", "teal", "from-teal-900/20 via-slate-800/70 to-slate-800/70", "from-teal-50 via-white to-white", "bg-teal-300", "bg-teal-500")}
              {kpiCard("WA DTI", kpis ? formatNum(kpis.waDti, 1) : "—", "waDti", "rose", "from-rose-900/20 via-slate-800/70 to-slate-800/70", "from-rose-50 via-white to-white", "bg-rose-300", "bg-rose-500")}
            </>
          )}
        </div>
      )}

      {/* Interest Rates widget (single-variant) */}
      {variant === "interest-rates" && (
        <Card className={cn("flex flex-col flex-1 min-h-0 rounded-xl border overflow-hidden", isDark ? "border-slate-700 bg-slate-800/50" : "border-slate-200/60 bg-white")}>
          <CardHeader className="pb-2 shrink-0">
            <CardTitle className={cn("text-base font-semibold", isDark ? "text-white" : "text-slate-900")}>Interest Rates</CardTitle>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Drill down from 1.00 increments --&gt; 0.125 increments --&gt; Rate</p>
          </CardHeader>
          <CardContent
            className="pb-4 flex-1 min-h-0 relative"
          >
            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-sky-500" /></div>
            ) : interestRates.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center">No data available</p>
            ) : (
              <div className="absolute inset-0 pt-0 px-6 pb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={interestRates} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#334155" : "#e2e8f0"} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: isDark ? "#94a3b8" : "#64748b" }} label={{ value: MEASURE_OPTIONS.find((o) => o.value === measure)?.label, position: "insideBottom", offset: -2, fontSize: 11, fill: isDark ? "#94a3b8" : "#64748b" }} />
                    <YAxis dataKey="bucket" type="category" tick={{ fontSize: 10, fill: isDark ? "#94a3b8" : "#64748b" }} width={100} />
                    <RechartsTooltip contentStyle={{ backgroundColor: isDark ? "#1e293b" : "#ffffff", border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`, borderRadius: "8px", fontSize: 12 }} formatter={(value: number) => [measure === "volume" ? formatCurrency(value) : formatNum(value, measure === "wac" ? 3 : 0), MEASURE_OPTIONS.find((o) => o.value === measure)?.label]} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} onClick={handleInterestRateBarClick} cursor="pointer">
                      {interestRates.map((entry, idx) => (<Cell key={idx} fill={rateColorScale(entry.value)} />))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Days to Lock Expiration widget (single-variant) */}
      {variant === "days-to-expiration" && (
        <Card className={cn("flex flex-col flex-1 min-h-0 rounded-xl border overflow-hidden", isDark ? "border-slate-700 bg-slate-800/50" : "border-slate-200/60 bg-white")}>
          <CardHeader className="pb-2 shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className={cn("text-base font-semibold", isDark ? "text-white" : "text-slate-900")}>Days to Lock Expiration</CardTitle>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{labelPrefix} Loans</p>
              </div>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExportDaysToExpiration} disabled={daysToExpiration.length === 0}>
                <Download className="h-4 w-4" />
                Export CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent
            className="pb-4 flex-1 min-h-0 flex flex-col"
          >
            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-sky-500" /></div>
            ) : daysToExpiration.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center">No data available</p>
            ) : (
              <div className="flex-1 min-h-0 overflow-auto overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className={cn("border-b", borderTh, bgTh)}>
                      <th className="py-2.5 px-4 text-left font-semibold">Time Range</th>
                      <th className="py-2.5 px-4 text-right font-semibold">Units</th>
                      <th className="py-2.5 px-4 text-right font-semibold">Volume</th>
                      <th className="py-2.5 px-4 text-right font-semibold">WAC</th>
                      <th className="py-2.5 px-4 text-right font-semibold">Avg Days Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const totals = daysToExpiration.reduce(
                        (acc, r) => ({ units: acc.units + r.units, volume: acc.volume + r.volume }),
                        { units: 0, volume: 0 }
                      );
                      return (
                        <tr className={cn("border-b font-semibold", borderRow, isDark ? "bg-slate-800/70" : "bg-slate-100/90")}>
                          <td className="py-2 px-4">Total</td>
                          <td className="py-2 px-4 text-right">{formatNum(totals.units)}</td>
                          <td className="py-2 px-4 text-right">{formatCurrency(totals.volume)}</td>
                          <td className="py-2 px-4 text-right"></td>
                          <td className="py-2 px-4 text-right"></td>
                        </tr>
                      );
                    })()}
                    {daysToExpiration.map((row) => (
                      <tr
                        key={row.bucket}
                        className={cn(
                          "border-b cursor-pointer transition-colors",
                          borderRow,
                          selectedExpirationBucket === row.bucket
                            ? "bg-blue-50/80 dark:bg-slate-700/60 ring-1 ring-inset ring-sky-500/70"
                            : row.bucket === "Expired"
                              ? (isDark ? "bg-red-900/40" : "bg-red-100")
                              : "hover:bg-slate-100/80 dark:hover:bg-slate-700/40",
                        )}
                        onClick={() => toggleExpirationBucketFilter(row.bucket)}
                      >
                        <td className={cn("py-2 px-4", row.bucket === "Expired" ? (isDark ? "text-red-300 font-semibold" : "text-red-800 font-semibold") : textTd)}>{row.bucket}</td>
                        <td className={cn("py-2 px-4 text-right", row.bucket === "Expired" ? (isDark ? "text-red-300" : "text-red-800") : textTd)}>{formatNum(row.units)}</td>
                        <td className={cn("py-2 px-4 text-right", row.bucket === "Expired" ? (isDark ? "text-red-300" : "text-red-800") : textTd)}>{formatCurrency(row.volume)}</td>
                        <td className={cn("py-2 px-4 text-right", row.bucket === "Expired" ? (isDark ? "text-red-300" : "text-red-800") : textTd)}>{row.wac.toFixed(3)}</td>
                        <td className={cn("py-2 px-4 text-right", row.bucket === "Expired" ? (isDark ? "text-red-300" : "text-red-800") : textTd)}>{Math.round(row.avgDaysActive)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Pull Through widget (single-variant) */}
      {variant === "pull-through" && (
        <Card className={cn("flex flex-col flex-1 min-h-0 rounded-xl border overflow-hidden", isDark ? "border-slate-700 bg-slate-800/50" : "border-slate-200/60 bg-white")}>
          <CardHeader className="pb-2 shrink-0">
            <CardTitle className={cn("text-base font-semibold", isDark ? "text-white" : "text-slate-900")}>Pull Through | Locked to Final Disposition</CardTitle>
            <p className="text-xs text-slate-500 dark:text-slate-400">Run Retroactively | Rolling {pullThroughPeriod === "ytd" ? "Year to Date" : `${pullThroughPeriod} Days`}</p>
            <div className="flex flex-wrap gap-1 pt-2">
              {PULL_THROUGH_PERIODS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => (groupId ? updateFilters(groupId, { lockStratPullThroughPeriod: opt.value }) : setLocalPullThroughPeriod(opt.value))}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                    pullThroughPeriod === opt.value ? "bg-emerald-600 text-white" : isDark ? "bg-slate-700/50 text-slate-300 hover:bg-slate-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent
            className="pb-4 flex-1 min-h-0 overflow-auto flex flex-col"
          >
            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-sky-500" /></div>
            ) : !pullThrough ? (
              <p className="text-sm text-slate-500 py-8 text-center">No data available</p>
            ) : (
              <div className={cn("space-y-4", isEmbedded && "flex flex-col flex-1 min-h-0")}>
                <div className="grid grid-cols-3 gap-4 shrink-0">
                  <div className={cn("rounded-lg p-3", isDark ? "bg-slate-700/50" : "bg-slate-50")}>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Locked AND Originate</p>
                    <p className={cn("text-xl font-bold", isDark ? "text-emerald-400" : "text-emerald-600")}>{pullThrough.originatedPct.toFixed(1)}%</p>
                  </div>
                  <div className={cn("rounded-lg p-3", isDark ? "bg-slate-700/50" : "bg-slate-50")}>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Locked AND Withdrew</p>
                    <p className={cn("text-xl font-bold", isDark ? "text-amber-400" : "text-amber-600")}>{pullThrough.withdrawnPct.toFixed(1)}%</p>
                  </div>
                  <div className={cn("rounded-lg p-3", isDark ? "bg-slate-700/50" : "bg-slate-50")}>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Locked AND Denied</p>
                    <p className={cn("text-xl font-bold", isDark ? "text-rose-400" : "text-rose-600")}>{pullThrough.deniedPct.toFixed(1)}%</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-4 text-xs shrink-0">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-500" />Locked AND Originate</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-500" />Locked AND Withdrew</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-rose-500" />Locked AND Denied</span>
                </div>
                {pullThrough.bars.length === 0 ? (
                  <p className="text-sm text-slate-500 py-8 text-center">No historical data available</p>
                ) : (
                  <div className={isEmbedded ? "flex-1 min-h-[200px] w-full" : undefined}>
                    <ResponsiveContainer width="100%" height={isEmbedded ? "100%" : 320}>
                    <BarChart data={pullThrough.bars} margin={{ top: 10, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#334155" : "#e2e8f0"} />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: isDark ? "#94a3b8" : "#64748b" }} />
                      <YAxis tick={{ fontSize: 11, fill: isDark ? "#94a3b8" : "#64748b" }} />
                      <RechartsTooltip contentStyle={{ backgroundColor: isDark ? "#1e293b" : "#ffffff", border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`, borderRadius: "8px", fontSize: 12 }} />
                      <Bar dataKey="lockedOriginated" name="Locked AND Originate" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="lockedWithdrawn" name="Locked AND Withdrew" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="lockedDenied" name="Locked AND Denied" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Active Loans by [group] – Bar chart widget (single-variant) */}
      {variant === "milestone-bar" && (
        <Card className={cn("flex flex-col flex-1 min-h-0 rounded-xl border overflow-hidden", isDark ? "border-slate-700 bg-slate-800/50" : "border-slate-200/60 bg-white")}>
          <CardHeader className="pb-2 shrink-0">
            <CardTitle className={cn("text-base font-semibold", isDark ? "text-white" : "text-slate-900")}>
              {labelPrefix} Loans by {MILESTONE_GROUP_OPTIONS.find((o) => o.value === milestoneGroupBy)?.label}
            </CardTitle>
            <p className="text-xs text-slate-500 dark:text-slate-400">Displaying Days until Lock Expires</p>
            <div className="flex flex-wrap gap-1">
              {MILESTONE_GROUP_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    (groupId
                      ? updateFilters(groupId, { lockStratMilestoneGroupBy: opt.value })
                      : setLocalMilestoneGroupBy(opt.value));
                    setExpandedPivotRows(new Set());
                    setSelectedMilestoneGroup(null);
                  }}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                    milestoneGroupBy === opt.value ? (isDark ? "bg-slate-600 text-white" : "bg-slate-700 text-white") : isDark ? "bg-slate-700/50 text-slate-300 hover:bg-slate-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent
            className="pb-4 flex-1 flex flex-col min-h-0 overflow-hidden"
          >
            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-sky-500" /></div>
            ) : milestoneBarData.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center">No data available</p>
            ) : (
              <div className="flex-1 min-h-0 overflow-auto">
                <div style={{ minHeight: Math.max(280, milestoneBarData.length * 24 + 60) }}>
                  <ResponsiveContainer width="100%" height={Math.max(280, milestoneBarData.length * 24 + 60)}>
                  <BarChart data={milestoneBarData} layout="vertical" margin={{ top: 8, right: 30, left: 10, bottom: 8 }} barCategoryGap={10}>
                    <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#334155" : "#e2e8f0"} />
                    <XAxis type="number" tick={{ fontSize: 12, fill: isDark ? "#94a3b8" : "#64748b" }} tickFormatter={(v: number) => measure === "volume" ? `${(v / 1_000_000).toFixed(1)}M` : formatNum(v, 0)} label={{ value: measure === "volume" ? "Volume" : measure === "units" ? "Units" : measure === "wac" ? "WAC" : "WA FICO", position: "insideBottom", offset: -2, fontSize: 12, fill: isDark ? "#94a3b8" : "#64748b" }} />
                    <YAxis dataKey="compositeKey" type="category" width={240} tick={renderMilestoneYAxisTick} />
                    <RechartsTooltip contentStyle={{ backgroundColor: isDark ? "#1e293b" : "#ffffff", border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`, borderRadius: "8px", fontSize: 12 }} labelFormatter={(label: string) => { const parts = String(label).split("||"); return `${parts[0]} — ${parts[1] || ""}`; }} formatter={(value: number) => [measure === "volume" ? formatCurrency(value) : formatNum(value, measure === "wac" ? 3 : 0), measure === "volume" ? "Volume" : measure === "units" ? "Units" : measure === "wac" ? "WAC" : "WA FICO"]} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {milestoneBarData.map((entry) => (
                        <Cell
                          key={entry.compositeKey}
                          fill={entry.bucketIdx >= 0 ? BUCKET_COLORS[entry.bucketIdx] : (isDark ? "#475569" : "#94a3b8")}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Active Loans by [group] – Pivot table widget (single-variant) */}
      {variant === "milestone-pivot" && (
        <Card className={cn("flex flex-col flex-1 min-h-0 rounded-xl border overflow-hidden", isDark ? "border-slate-700 bg-slate-800/50" : "border-slate-200/60 bg-white")}>
          <CardHeader className="pb-2 shrink-0">
            <CardTitle className={cn("text-base font-semibold", isDark ? "text-white" : "text-slate-900")}>
              {labelPrefix} Loans by {MILESTONE_GROUP_OPTIONS.find((o) => o.value === milestoneGroupBy)?.label}
            </CardTitle>
            <p className="text-xs text-slate-500 dark:text-slate-400">Displaying Days until Lock Expires</p>
            <div className="flex flex-wrap gap-1">
              {MILESTONE_GROUP_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    (groupId
                      ? updateFilters(groupId, { lockStratMilestoneGroupBy: opt.value })
                      : setLocalMilestoneGroupBy(opt.value));
                    setSelectedMilestoneGroup(null);
                  }}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                    milestoneGroupBy === opt.value ? (isDark ? "bg-slate-600 text-white" : "bg-slate-700 text-white") : isDark ? "bg-slate-700/50 text-slate-300 hover:bg-slate-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="flex justify-end pt-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExportPivot} disabled={sortedPivotRows.length === 0}>
                <Download className="h-4 w-4" />
                Export CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent
            className="pb-4 flex-1 min-h-0 overflow-auto flex flex-col"
          >
            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-sky-500" /></div>
            ) : (
              <div className={isEmbedded ? "flex-1 min-h-0 overflow-auto overflow-x-auto" : "overflow-x-auto"}>
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className={cn("border-b", borderTh, bgTh)}>
                      <th className="py-2.5 px-4 text-left font-semibold">{MILESTONE_GROUP_OPTIONS.find((o) => o.value === milestoneGroupBy)?.label}</th>
                      <th className="py-2.5 px-4 text-right font-semibold">Active Locked Units</th>
                      <th className="py-2.5 px-4 text-right font-semibold">Active Locked Volume</th>
                      <th className="py-2.5 px-4 text-right font-semibold">Active Locked %</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className={cn("border-b font-semibold", borderRow, isDark ? "bg-slate-800/70" : "bg-slate-100/90")}>
                      <td className="py-2 px-4">Total</td>
                      <td className="py-2 px-4 text-right">{formatNum(milestonePivot.totals.units)}</td>
                      <td className="py-2 px-4 text-right">{formatCurrency(milestonePivot.totals.volume)}</td>
                      <td className="py-2 px-4 text-right">100.0%</td>
                    </tr>
                    {sortedPivotRows.map((row) => (
                      <React.Fragment key={row.group}>
                        <tr
                          className={cn(
                            "border-b transition-colors",
                            borderRow,
                            selectedMilestoneGroup === row.group
                              ? "bg-blue-50/80 dark:bg-slate-700/60 ring-1 ring-inset ring-sky-500/70"
                              : "",
                          )}
                        >
                          <td className="py-2 px-4 font-medium">
                            <span className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                className="rounded-sm p-0.5 hover:bg-slate-200/70 dark:hover:bg-slate-600/70"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  togglePivotRow(row.group);
                                }}
                                aria-label={`Toggle ${row.group} details`}
                              >
                                <ChevronRight className={cn("h-4 w-4 transition-transform", expandedPivotRows.has(row.group) && "rotate-90")} />
                              </button>
                              <button
                                type="button"
                                className="text-left font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded-sm"
                                onClick={() => toggleMilestoneGroupFilter(row.group)}
                              >
                                {row.group}
                              </button>
                            </span>
                          </td>
                          <td className={cn("py-2 px-4 text-right", textTd)}>{formatNum(row.units)}</td>
                          <td className={cn("py-2 px-4 text-right", textTd)}>{formatCurrency(row.volume)}</td>
                          <td className={cn("py-2 px-4 text-right", textTd)}>{row.pct.toFixed(1)}%</td>
                        </tr>
                        {expandedPivotRows.has(row.group) && row.children.map((child) => (
                          <tr key={`${row.group}-${child.bucket}`} className={cn("border-b", borderRow, isDark ? "bg-slate-800/30" : "bg-slate-50/50")}>
                            <td className="py-1.5 px-4 pl-10 text-slate-500 dark:text-slate-400 text-xs">{child.bucket}</td>
                            <td className={cn("py-1.5 px-4 text-right text-xs", "text-blue-600 dark:text-blue-400")}>{formatNum(child.units)}</td>
                            <td className={cn("py-1.5 px-4 text-right text-xs", textTd)}>{formatCurrency(child.volume)}</td>
                            <td className={cn("py-1.5 px-4 text-right text-xs", textTd)}>{child.pct.toFixed(1)}%</td>
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {variant === "full" && (
    <>
      {/* ── Filters ── (only when standalone, not when groupId/embedded) */}
      {!groupId && (
      <Card className={cn("rounded-xl border", isDark ? "border-slate-700 bg-slate-800/50" : "border-slate-200/60 bg-white")}>
        <CardContent className="pt-5 pb-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Locked?</label>
            <Select value={locked} onValueChange={(v) => (groupId ? updateFilters(groupId, { lockStratLocked: v as LockedFilter }) : setLocalLocked(v as LockedFilter))}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCKED_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Select Measure</label>
            <Select value={measure} onValueChange={(v) => (groupId ? updateFilters(groupId, { lockStratMeasure: v as MeasureFilter }) : setLocalMeasure(v as MeasureFilter))}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEASURE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          </div>
        </CardContent>
      </Card>
      )}
      {activeFilterLabels.length > 0 && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-blue-100/80 bg-blue-50/50 px-3 py-2 dark:border-slate-700/80 dark:bg-slate-900/40">
            <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Active filters</span>
            {activeFilterLabels.map((filter) => (
              <span key={filter.key} className="inline-flex items-center gap-1 rounded-full border border-sky-500 bg-sky-500 px-2.5 py-0.5 text-sm font-medium text-white">
                {filter.text}
                <button
                  type="button"
                  onClick={filter.onClear}
                  className="rounded-sm p-0.5 transition-colors hover:bg-sky-600/80"
                  aria-label={`Clear ${filter.key} filter`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={clearAllDrillFilters}>
              Clear all filters
            </Button>
          </div>
        </div>
      )}

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        {loading && !kpis ? (
          [...Array(8)].map((_, i) => (
            <Card key={i} className={cn("rounded-xl border", isDark ? "border-slate-700 bg-slate-800/50" : "border-slate-200/60 bg-white")}>
              <CardContent className="pt-6 flex items-center justify-center h-20">
                <Loader2 className="h-6 w-6 animate-spin text-sky-500" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            {kpiCard(`${labelPrefix} Volume`, kpis ? formatCurrency(kpis.volume) : "—", "volume", "blue", "from-blue-900/20 via-slate-800/70 to-slate-800/70", "from-blue-50 via-white to-white", "bg-blue-300", "bg-blue-500")}
            {kpiCard(`${labelPrefix} Units`, kpis ? formatNum(kpis.units) : "—", "units", "purple", "from-purple-900/20 via-slate-800/70 to-slate-800/70", "from-purple-50 via-white to-white", "bg-purple-300", "bg-purple-500")}
            {kpiCard("Average Balance", kpis ? formatCurrency(kpis.avgBalance) : "—", "avgBalance", "amber", "from-amber-900/20 via-slate-800/70 to-slate-800/70", "from-amber-50 via-white to-white", "bg-amber-300", "bg-amber-500")}
            {kpiCard("Avg Days Active", kpis ? formatNum(kpis.avgDaysActive) : "—", "avgDaysActive", "emerald", "from-emerald-900/20 via-slate-800/70 to-slate-800/70", "from-emerald-50 via-white to-white", "bg-emerald-300", "bg-emerald-500")}
            {kpiCard("WAC", kpis ? formatNum(kpis.wac, 3) : "—", "wac", "sky", "from-sky-900/20 via-slate-800/70 to-slate-800/70", "from-sky-50 via-white to-white", "bg-sky-300", "bg-sky-500")}
            {kpiCard("WA FICO", kpis ? formatNum(kpis.waFico) : "—", "waFico", "indigo", "from-indigo-900/20 via-slate-800/70 to-slate-800/70", "from-indigo-50 via-white to-white", "bg-indigo-300", "bg-indigo-500")}
            {kpiCard("WA LTV", kpis ? `${formatNum(kpis.waLtv, 1)}` : "—", "waLtv", "teal", "from-teal-900/20 via-slate-800/70 to-slate-800/70", "from-teal-50 via-white to-white", "bg-teal-300", "bg-teal-500")}
            {kpiCard("WA DTI", kpis ? formatNum(kpis.waDti, 1) : "—", "waDti", "rose", "from-rose-900/20 via-slate-800/70 to-slate-800/70", "from-rose-50 via-white to-white", "bg-rose-300", "bg-rose-500")}
          </>
        )}
      </div>

      {displayError && (
        <p className="text-sm text-red-600 dark:text-red-400">{displayError}</p>
      )}

      {/* ── Two-Column Layout: Left (Interest Rates + Days to Expiration) | Right (Milestone Chart) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
        {/* ── Left Column ── */}
        <div className="flex flex-col gap-4">
        {/* Interest Rates */}
        <Card className={cn("rounded-xl border overflow-hidden", isDark ? "border-slate-700 bg-slate-800/50" : "border-slate-200/60 bg-white")}>
          <CardHeader className="pb-2">
            <CardTitle className={cn("text-base font-semibold", isDark ? "text-white" : "text-slate-900")}>
              Interest Rates
            </CardTitle>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Drill down from 1.00 increments --&gt; 0.125 increments --&gt; Rate
            </p>
          </CardHeader>
          <CardContent className="pb-4">
            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-sky-500" /></div>
            ) : interestRates.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center">No data available</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(interestRates.length * 48, 200)}>
                <BarChart data={interestRates} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#334155" : "#e2e8f0"} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: isDark ? "#94a3b8" : "#64748b" }}
                    label={{ value: MEASURE_OPTIONS.find((o) => o.value === measure)?.label, position: "insideBottom", offset: -2, fontSize: 11, fill: isDark ? "#94a3b8" : "#64748b" }}
                  />
                  <YAxis
                    dataKey="bucket"
                    type="category"
                    tick={{ fontSize: 10, fill: isDark ? "#94a3b8" : "#64748b" }}
                    width={100}
                    label={(props: Record<string, unknown>) => {
                      const viewBox = props.viewBox as { x?: number; y?: number; width?: number; height?: number } | undefined;
                      const x = (viewBox?.x ?? 0) + 15;
                      const y = (viewBox?.y ?? 0) + ((viewBox?.height ?? 200) / 2);
                      const fill = isDark ? "#94a3b8" : "#64748b";
                      return (
                        <text x={x} y={y} fill={fill} fontSize={11} textAnchor="middle" dominantBaseline="middle" transform={`rotate(-90, ${x}, ${y})`} style={{ letterSpacing: '0.08em' }}>
                          Interest Rate
                        </text>
                      );
                    }}
                  />
                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: isDark ? "#1e293b" : "#ffffff",
                      border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                      borderRadius: "8px",
                      fontSize: 12,
                    }}
                    formatter={(value: number) => [
                      measure === "volume" ? formatCurrency(value) : formatNum(value, measure === "wac" ? 3 : 0),
                      MEASURE_OPTIONS.find((o) => o.value === measure)?.label,
                    ]}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} onClick={handleInterestRateBarClick} cursor="pointer">
                    {interestRates.map((entry, idx) => (
                      <Cell key={idx} fill={rateColorScale(entry.value)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Days to Lock Expiration Table */}
        <Card className={cn("rounded-xl border overflow-hidden", isDark ? "border-slate-700 bg-slate-800/50" : "border-slate-200/60 bg-white")}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className={cn("text-base font-semibold", isDark ? "text-white" : "text-slate-900")}>
                  Days to Lock Expiration
                </CardTitle>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{labelPrefix} Loans</p>
              </div>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExportDaysToExpiration} disabled={daysToExpiration.length === 0}>
                <Download className="h-4 w-4" />
                Export CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-sky-500" /></div>
            ) : daysToExpiration.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center">No data available</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className={cn("border-b", borderTh, bgTh)}>
                      <th className="py-2.5 px-4 text-left font-semibold">Time Range</th>
                      <th className="py-2.5 px-4 text-right font-semibold">Units</th>
                      <th className="py-2.5 px-4 text-right font-semibold">Volume</th>
                      <th className="py-2.5 px-4 text-right font-semibold">WAC</th>
                      <th className="py-2.5 px-4 text-right font-semibold">Avg Days Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const totals = daysToExpiration.reduce(
                        (acc, r) => ({ units: acc.units + r.units, volume: acc.volume + r.volume }),
                        { units: 0, volume: 0 }
                      );
                      return (
                        <tr className={cn("border-b font-semibold", borderRow, isDark ? "bg-slate-800/70" : "bg-slate-100/90")}>
                          <td className="py-2 px-4">Total</td>
                          <td className="py-2 px-4 text-right">{formatNum(totals.units)}</td>
                          <td className="py-2 px-4 text-right">{formatCurrency(totals.volume)}</td>
                          <td className="py-2 px-4 text-right"></td>
                          <td className="py-2 px-4 text-right"></td>
                        </tr>
                      );
                    })()}
                    {daysToExpiration.map((row) => (
                      <tr key={row.bucket} className={cn(
                        "border-b cursor-pointer transition-colors",
                        borderRow,
                        selectedExpirationBucket === row.bucket
                          ? "bg-blue-50/80 dark:bg-slate-700/60 ring-1 ring-inset ring-sky-500/70"
                          : row.bucket === "Expired"
                            ? (isDark ? "bg-red-900/40" : "bg-red-100")
                            : "hover:bg-slate-100/80 dark:hover:bg-slate-700/40",
                      )} onClick={() => toggleExpirationBucketFilter(row.bucket)}>
                        <td className={cn("py-2 px-4", row.bucket === "Expired" ? (isDark ? "text-red-300 font-semibold" : "text-red-800 font-semibold") : textTd)}>{row.bucket}</td>
                        <td className={cn("py-2 px-4 text-right", row.bucket === "Expired" ? (isDark ? "text-red-300" : "text-red-800") : textTd)}>{formatNum(row.units)}</td>
                        <td className={cn("py-2 px-4 text-right", row.bucket === "Expired" ? (isDark ? "text-red-300" : "text-red-800") : textTd)}>{formatCurrency(row.volume)}</td>
                        <td className={cn("py-2 px-4 text-right", row.bucket === "Expired" ? (isDark ? "text-red-300" : "text-red-800") : textTd)}>{row.wac.toFixed(3)}</td>
                        <td className={cn("py-2 px-4 text-right", row.bucket === "Expired" ? (isDark ? "text-red-300" : "text-red-800") : textTd)}>{Math.round(row.avgDaysActive)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
        {/* Pull Through */}
        <Card className={cn("rounded-xl border overflow-hidden", isDark ? "border-slate-700 bg-slate-800/50" : "border-slate-200/60 bg-white")}>
          <CardHeader className="pb-2">
            <CardTitle className={cn("text-base font-semibold", isDark ? "text-white" : "text-slate-900")}>
              Pull Through | Locked to Final Disposition
            </CardTitle>
            <p className="text-xs text-slate-500 dark:text-slate-400">Run Retroactively | Rolling {pullThroughPeriod === "ytd" ? "Year to Date" : `${pullThroughPeriod} Days`}</p>
            <div className="flex flex-wrap gap-1 pt-2">
              {PULL_THROUGH_PERIODS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => (groupId ? updateFilters(groupId, { lockStratPullThroughPeriod: opt.value }) : setLocalPullThroughPeriod(opt.value))}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                    pullThroughPeriod === opt.value
                      ? "bg-emerald-600 text-white"
                      : isDark ? "bg-slate-700/50 text-slate-300 hover:bg-slate-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-sky-500" /></div>
            ) : !pullThrough ? (
              <p className="text-sm text-slate-500 py-8 text-center">No data available</p>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className={cn("rounded-lg p-3", isDark ? "bg-slate-700/50" : "bg-slate-50")}>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Locked AND Originate</p>
                    <p className={cn("text-xl font-bold", isDark ? "text-emerald-400" : "text-emerald-600")}>{pullThrough.originatedPct.toFixed(1)}%</p>
                  </div>
                  <div className={cn("rounded-lg p-3", isDark ? "bg-slate-700/50" : "bg-slate-50")}>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Locked AND Withdrew</p>
                    <p className={cn("text-xl font-bold", isDark ? "text-amber-400" : "text-amber-600")}>{pullThrough.withdrawnPct.toFixed(1)}%</p>
                  </div>
                  <div className={cn("rounded-lg p-3", isDark ? "bg-slate-700/50" : "bg-slate-50")}>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Locked AND Denied</p>
                    <p className={cn("text-xl font-bold", isDark ? "text-rose-400" : "text-rose-600")}>{pullThrough.deniedPct.toFixed(1)}%</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-4 text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm bg-emerald-500" />
                    Locked AND Originate
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm bg-amber-500" />
                    Locked AND Withdrew
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm bg-rose-500" />
                    Locked AND Denied
                  </span>
                </div>
                {pullThrough.bars.length === 0 ? (
                  <p className="text-sm text-slate-500 py-8 text-center">No historical data available</p>
                ) : (
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={pullThrough.bars} margin={{ top: 10, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#334155" : "#e2e8f0"} />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: isDark ? "#94a3b8" : "#64748b" }} />
                      <YAxis tick={{ fontSize: 11, fill: isDark ? "#94a3b8" : "#64748b" }} />
                      <RechartsTooltip
                        contentStyle={{
                          backgroundColor: isDark ? "#1e293b" : "#ffffff",
                          border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                          borderRadius: "8px",
                          fontSize: 12,
                        }}
                      />
                    <Bar dataKey="lockedOriginated" name="Locked AND Originate" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="lockedWithdrawn" name="Locked AND Withdrew" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="lockedDenied" name="Locked AND Denied" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        </div>{/* end left column */}

        {/* ── Right Column: Milestone Chart / Pivot ── */}
        <Card className={cn("flex flex-col h-full min-h-0 rounded-xl border overflow-hidden", isDark ? "border-slate-700 bg-slate-800/50" : "border-slate-200/60 bg-white")}>
          <CardHeader className="pb-2">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <CardTitle className={cn("text-base font-semibold", isDark ? "text-white" : "text-slate-900")}>
                  {labelPrefix} Loans by {MILESTONE_GROUP_OPTIONS.find((o) => o.value === milestoneGroupBy)?.label}
                </CardTitle>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Displaying Days until Lock Expires</p>
              {/* Group-by tabs */}
              <div className="flex flex-wrap gap-1">
                {MILESTONE_GROUP_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      (groupId
                        ? updateFilters(groupId, { lockStratMilestoneGroupBy: opt.value })
                        : setLocalMilestoneGroupBy(opt.value));
                      setExpandedPivotRows(new Set());
                      setSelectedMilestoneGroup(null);
                    }}
                    className={cn(
                      "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                      milestoneGroupBy === opt.value
                        ? isDark
                          ? "bg-slate-600 text-white"
                          : "bg-slate-700 text-white"
                        : isDark
                          ? "bg-slate-700/50 text-slate-300 hover:bg-slate-700"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {/* Bar / Pivot toggle */}
              <div className="flex gap-1">
                <button
                  onClick={() => setMilestoneView("bar")}
                  className={cn(
                    "px-4 py-1.5 text-xs font-medium rounded-md transition-colors",
                    milestoneView === "bar"
                      ? "bg-emerald-600 text-white"
                      : isDark ? "bg-slate-700/50 text-slate-300 hover:bg-slate-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  )}
                >
                  Bar
                </button>
                <button
                  onClick={() => setMilestoneView("pivot")}
                  className={cn(
                    "px-4 py-1.5 text-xs font-medium rounded-md transition-colors",
                    milestoneView === "pivot"
                      ? "bg-emerald-600 text-white"
                      : isDark ? "bg-slate-700/50 text-slate-300 hover:bg-slate-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  )}
                >
                  Pivot
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent className={cn("pb-4", milestoneView === "bar" && milestoneBarData.length > 0 && "flex-1 flex flex-col min-h-0")}>
            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-sky-500" /></div>
            ) : milestoneView === "bar" ? (
              /* ── Bar Chart ── */
              milestoneBarData.length === 0 ? (
                <p className="text-sm text-slate-500 py-8 text-center">No data available</p>
              ) : (
                <div style={{ minHeight: Math.max(280, milestoneBarData.length * 24 + 60) }}>
                  <ResponsiveContainer width="100%" height={Math.max(280, milestoneBarData.length * 24 + 60)}>
                    <BarChart data={milestoneBarData} layout="vertical" margin={{ top: 8, right: 30, left: 10, bottom: 8 }} barCategoryGap={10}>
                      <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#334155" : "#e2e8f0"} />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 12, fill: isDark ? "#94a3b8" : "#64748b" }}
                        tickFormatter={(v: number) => measure === "volume" ? `${(v / 1_000_000).toFixed(1)}M` : formatNum(v, 0)}
                        label={{ value: measure === "volume" ? "Volume" : measure === "units" ? "Units" : measure === "wac" ? "WAC" : "WA FICO", position: "insideBottom", offset: -2, fontSize: 12, fill: isDark ? "#94a3b8" : "#64748b" }}
                      />
                      <YAxis dataKey="compositeKey" type="category" width={240} tick={renderMilestoneYAxisTick} />
                      <RechartsTooltip
                        contentStyle={{
                          backgroundColor: isDark ? "#1e293b" : "#ffffff",
                          border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                          borderRadius: "8px",
                          fontSize: 12,
                        }}
                        labelFormatter={(label: string) => {
                          const parts = String(label).split("||");
                          return `${parts[0]} — ${parts[1] || ""}`;
                        }}
                        formatter={(value: number) => [
                          measure === "volume" ? formatCurrency(value) : formatNum(value, measure === "wac" ? 3 : 0),
                          measure === "volume" ? "Volume" : measure === "units" ? "Units" : measure === "wac" ? "WAC" : "WA FICO",
                        ]}
                      />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                        {milestoneBarData.map((entry) => (
                          <Cell
                            key={entry.compositeKey}
                            fill={entry.bucketIdx >= 0 ? BUCKET_COLORS[entry.bucketIdx] : (isDark ? "#475569" : "#94a3b8")}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )
            ) : (
              /* ── Pivot Table ── */
              <div className="space-y-2">
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExportPivot} disabled={sortedPivotRows.length === 0}>
                    <Download className="h-4 w-4" />
                    Export CSV
                  </Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className={cn("border-b", borderTh, bgTh)}>
                        <th className="py-2.5 px-4 text-left font-semibold">{MILESTONE_GROUP_OPTIONS.find((o) => o.value === milestoneGroupBy)?.label}</th>
                        <th className="py-2.5 px-4 text-right font-semibold">Active Locked Units</th>
                        <th className="py-2.5 px-4 text-right font-semibold">Active Locked Volume</th>
                        <th className="py-2.5 px-4 text-right font-semibold">Active Locked %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Total row */}
                      <tr className={cn("border-b font-semibold", borderRow, isDark ? "bg-slate-800/70" : "bg-slate-100/90")}>
                        <td className="py-2 px-4">Total</td>
                        <td className="py-2 px-4 text-right">{formatNum(milestonePivot.totals.units)}</td>
                        <td className="py-2 px-4 text-right">{formatCurrency(milestonePivot.totals.volume)}</td>
                        <td className="py-2 px-4 text-right">100.0%</td>
                      </tr>
                      {sortedPivotRows.map((row) => (
                        <React.Fragment key={row.group}>
                          <tr
                            className={cn(
                              "border-b transition-colors",
                              borderRow,
                              selectedMilestoneGroup === row.group
                                ? "bg-blue-50/80 dark:bg-slate-700/60 ring-1 ring-inset ring-sky-500/70"
                                : "",
                            )}
                          >
                            <td className="py-2 px-4 font-medium">
                              <span className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  className="rounded-sm p-0.5 hover:bg-slate-200/70 dark:hover:bg-slate-600/70"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    togglePivotRow(row.group);
                                  }}
                                  aria-label={`Toggle ${row.group} details`}
                                >
                                  <ChevronRight className={cn("h-4 w-4 transition-transform", expandedPivotRows.has(row.group) && "rotate-90")} />
                                </button>
                                <button
                                  type="button"
                                  className="text-left font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded-sm"
                                  onClick={() => toggleMilestoneGroupFilter(row.group)}
                                >
                                  {row.group}
                                </button>
                              </span>
                            </td>
                            <td className={cn("py-2 px-4 text-right", textTd)}>{formatNum(row.units)}</td>
                            <td className={cn("py-2 px-4 text-right", textTd)}>{formatCurrency(row.volume)}</td>
                            <td className={cn("py-2 px-4 text-right", textTd)}>{row.pct.toFixed(1)}%</td>
                          </tr>
                          {expandedPivotRows.has(row.group) && row.children.map((child) => (
                            <tr key={`${row.group}-${child.bucket}`} className={cn("border-b", borderRow, isDark ? "bg-slate-800/30" : "bg-slate-50/50")}>
                              <td className="py-1.5 px-4 pl-10 text-slate-500 dark:text-slate-400 text-xs">{child.bucket}</td>
                              <td className={cn("py-1.5 px-4 text-right text-xs", "text-blue-600 dark:text-blue-400")}>{formatNum(child.units)}</td>
                              <td className={cn("py-1.5 px-4 text-right text-xs", textTd)}>{formatCurrency(child.volume)}</td>
                              <td className={cn("py-1.5 px-4 text-right text-xs", textTd)}>{child.pct.toFixed(1)}%</td>
                            </tr>
                          ))}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      </>)}
    </div>
  );
}
