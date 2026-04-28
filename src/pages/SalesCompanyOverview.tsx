import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TopTieringLayout } from "@/components/layout/TopTieringLayout";
import { TopTieringTopBar } from "@/components/layout/TopTieringTopBar";
import {
  useSalesCompanyOverviewData,
  type SalesCompanyOverviewAgingBucket,
} from "@/hooks/useSalesCompanyOverviewData";
import {
  normalizeSalesCompanyOverviewViewState,
  persistSalesCompanyOverviewFiltersLocally,
  useSalesCompanyOverviewViewState,
} from "@/hooks/useSalesCompanyOverviewViewState";
import { useTenantStore } from "@/stores/tenantStore";
import { useChannelStore } from "@/stores/channelStore";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  Activity,
  BadgeDollarSign,
  CalendarDays,
  Loader2,
  X,
} from "lucide-react";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

type LoanTypeDatum = {
  name: string;
  count: number;
  percent: number;
  fill: string;
};

const TYPE_COLORS = [
  "#312e81",
  "#14b8a6",
  "#7dd3fc",
  "#15803d",
  "#f97316",
  "#e11d48",
  "#9333ea",
];

const AGING_COLORS: Record<string, string> = {
  "0-15": "#14b8a6",
  "16-30": "#3b82f6",
  "31-45": "#6366f1",
  "46-60": "#f59e0b",
  "61-90": "#f97316",
  ">90": "#ef4444",
};

const AGING_BUCKET_KEYS = new Set<string>([
  "0-15",
  "16-30",
  "31-45",
  "46-60",
  "61-90",
  ">90",
]);

/** Full-size chart segments; de-emphasize categories not in the current selection. */
const CHART_DEEMPHASIS_FILL = "#cbd5e1";

const formatVolume = (value: number): string => {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toLocaleString()}`;
};

const formatWac = (value: number): string => `${(value || 0).toFixed(3)}%`;

const dashboardCardClass =
  "rounded-xl backdrop-blur-sm border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)] dark:border-slate-700/50 dark:bg-slate-800/70 dark:shadow-[0_8px_24px_rgba(0,0,0,0.3)]";

const chartHeaderClass =
  "border-b border-blue-100/50 bg-gradient-to-r from-blue-50/70 to-purple-50/40 pb-3 dark:border-slate-700/50 dark:from-slate-800/70 dark:to-slate-700/40";

/** Shared height for the aging bar + loan-type donuts so the xl row aligns; legend is not scroll-clipped. */
const overviewChartsRowHeightClass = "h-[500px]";

const tooltipClass =
  "rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900";

const EmptyChartState = ({ label }: { label: string }) => (
  <div className="flex h-full min-h-[220px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/70 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-500">
    {label}
  </div>
);

/** Donut without outside labels (avoids Recharts label/labelLine misalignment). Legend lists name, count, share. */
const LoanTypeDonutChart = ({
  data,
  tooltipClassName,
  selectedLoanTypes,
  onSliceClick,
}: {
  data: LoanTypeDatum[];
  tooltipClassName: string;
  selectedLoanTypes: string[];
  onSliceClick?: (name: string) => void;
}) => {
  const selectionActive = selectedLoanTypes.length > 0;

  return (
    <div className="grid h-full min-h-0 grid-rows-[1fr_auto] gap-1">
      <div className="min-h-0 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
            <Pie
              data={data}
              dataKey="count"
              nameKey="name"
              innerRadius="58%"
              outerRadius="88%"
              paddingAngle={2}
              label={false}
              labelLine={false}
              className={onSliceClick ? "cursor-pointer [&_path]:outline-none" : undefined}
              onClick={
                onSliceClick
                  ? (sliceProps: unknown) => {
                      const p = sliceProps as { name?: string; payload?: { name?: string } };
                      const name = p?.payload?.name ?? p?.name;
                      if (name) onSliceClick(String(name));
                    }
                  : undefined
              }
            >
              {data.map((entry) => {
                const dimmed = selectionActive && !selectedLoanTypes.includes(entry.name);
                return (
                  <Cell key={entry.name} fill={dimmed ? CHART_DEEMPHASIS_FILL : entry.fill} />
                );
              })}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const item = payload[0].payload as LoanTypeDatum;
                return (
                  <div className={tooltipClassName}>
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{item.name}</p>
                    <p className="mt-1 text-slate-500 dark:text-slate-400">
                      {item.count.toLocaleString()} loans | {item.percent.toFixed(1)}%
                    </p>
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="shrink-0 border-t border-slate-100/90 px-1 pt-1.5 dark:border-slate-700/70">
        <div className="grid grid-cols-3 gap-x-2 gap-y-2">
          {data.map((d) => {
            const isSelected = selectedLoanTypes.includes(d.name);
            const dimmed = selectionActive && !isSelected;
            const swatch = dimmed ? CHART_DEEMPHASIS_FILL : d.fill;
            return (
              <button
                key={d.name}
                type="button"
                disabled={!onSliceClick}
                title={`${d.name}: ${d.count.toLocaleString()} units, ${d.percent.toFixed(1)}% share`}
                aria-pressed={isSelected}
                onClick={() => onSliceClick?.(d.name)}
                className={cn(
                  "flex min-w-0 gap-1.5 rounded-md px-1 py-1 text-left transition-colors",
                  onSliceClick && "cursor-pointer hover:bg-slate-100/90 dark:hover:bg-slate-800/90",
                  !onSliceClick && "cursor-default",
                  dimmed && "opacity-45",
                  isSelected && selectionActive && "bg-blue-50/90 ring-1 ring-blue-200/80 dark:bg-slate-800 dark:ring-slate-600",
                )}
              >
                <span
                  className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-black/5 dark:ring-white/10"
                  style={{ backgroundColor: swatch }}
                  aria-hidden
                />
                <span className="min-w-0 flex flex-col gap-0.5">
                  <span className="truncate text-sm font-semibold leading-snug text-slate-800 dark:text-slate-100">
                    {d.name}
                  </span>
                  <span className="text-xs leading-snug tabular-nums text-slate-600 dark:text-slate-400">
                    {d.count.toLocaleString()} units · {d.percent.toFixed(1)}% share
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const toLoanTypeData = (values?: Record<string, number>): LoanTypeDatum[] => {
  if (!values) return [];
  const total = Object.values(values).reduce((sum, count) => sum + Number(count || 0), 0);
  if (!total) return [];

  return Object.entries(values)
    .map(([name, count], index) => {
      const normalizedCount = Number(count || 0);
      return {
        name,
        count: normalizedCount,
        percent: (normalizedCount / total) * 100,
        fill: TYPE_COLORS[index % TYPE_COLORS.length],
      };
    })
    .sort((a, b) => b.count - a.count);
};

const SalesCompanyOverview = () => {
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();
  const { user } = useAuth();
  const tenantId = selectedTenantId || user?.tenant_id || null;

  const persistedViewState = useSalesCompanyOverviewViewState({ tenantId });
  const isPersistenceEnabled = Boolean(tenantId && persistedViewState.preferenceKey);
  const hydratedPreferenceKeyRef = useRef<string | null>(null);

  const [loanTypeFilters, setLoanTypeFilters] = useState<string[]>([]);
  const [agingBucketFilters, setAgingBucketFilters] = useState<SalesCompanyOverviewAgingBucket[]>([]);

  useEffect(() => {
    if (!isPersistenceEnabled || !persistedViewState.preferenceKey) {
      hydratedPreferenceKeyRef.current = null;
      return;
    }
    if (hydratedPreferenceKeyRef.current === persistedViewState.preferenceKey) return;

    setLoanTypeFilters([]);
    setAgingBucketFilters([]);

    let cancelled = false;
    void persistedViewState
      .load()
      .then((loaded) => {
        if (cancelled) return;
        if (loaded) {
          setLoanTypeFilters(loaded.loanTypes);
          setAgingBucketFilters(loaded.agingBuckets);
        }
        hydratedPreferenceKeyRef.current = persistedViewState.preferenceKey;
      })
      .catch(() => {
        if (!cancelled) hydratedPreferenceKeyRef.current = persistedViewState.preferenceKey;
      });
    return () => {
      cancelled = true;
    };
  }, [isPersistenceEnabled, persistedViewState.preferenceKey, persistedViewState.load]);

  const savePersistedViewState = useCallback(async () => {
    if (!isPersistenceEnabled) return;
    const payload = normalizeSalesCompanyOverviewViewState({
      version: 2,
      loanTypes: loanTypeFilters,
      agingBuckets: agingBucketFilters,
    });
    await persistedViewState.save(payload);
  }, [isPersistenceEnabled, loanTypeFilters, agingBucketFilters, persistedViewState]);

  useEffect(() => {
    if (!isPersistenceEnabled) return;
    if (!persistedViewState.preferenceKey) return;
    if (persistedViewState.isLoading) return;
    if (hydratedPreferenceKeyRef.current !== persistedViewState.preferenceKey) return;
    const t = window.setTimeout(() => {
      void savePersistedViewState();
    }, 400);
    return () => window.clearTimeout(t);
  }, [
    isPersistenceEnabled,
    persistedViewState.preferenceKey,
    persistedViewState.isLoading,
    savePersistedViewState,
  ]);

  useEffect(() => {
    if (!persistedViewState.preferenceKey) return;
    const key = persistedViewState.preferenceKey;
    const flush = () => {
      persistSalesCompanyOverviewFiltersLocally(key, loanTypeFilters, agingBucketFilters);
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [persistedViewState.preferenceKey, loanTypeFilters, agingBucketFilters]);

  const sliceFilters = useMemo(
    () => ({
      loanTypes: loanTypeFilters,
      agingBuckets: agingBucketFilters,
    }),
    [loanTypeFilters, agingBucketFilters],
  );

  const { data: companyOverviewData, loading } = useSalesCompanyOverviewData(
    tenantId,
    selectedChannel,
    sliceFilters,
  );

  const toggleLoanType = useCallback((name: string) => {
    setLoanTypeFilters((prev) => {
      const set = new Set(prev);
      if (set.has(name)) set.delete(name);
      else set.add(name);
      return [...set].sort((a, b) => a.localeCompare(b));
    });
  }, []);

  const toggleAgingBucket = useCallback((range: string) => {
    if (!AGING_BUCKET_KEYS.has(range)) return;
    const key = range as SalesCompanyOverviewAgingBucket;
    setAgingBucketFilters((prev) => {
      const set = new Set(prev);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      return [...set].sort((a, b) => a.localeCompare(b)) as SalesCompanyOverviewAgingBucket[];
    });
  }, []);

  const clearAllChartFilters = useCallback(() => {
    setLoanTypeFilters([]);
    setAgingBucketFilters([]);
  }, []);

  const handleAgingBarChartClick = useCallback(
    (state: unknown) => {
      const s = state as { activePayload?: Array<{ payload?: { range?: string } }> } | null;
      const range = s?.activePayload?.[0]?.payload?.range;
      if (range) toggleAgingBucket(range);
    },
    [toggleAgingBucket],
  );

  const hasChartFilters = loanTypeFilters.length > 0 || agingBucketFilters.length > 0;

  const chartSelectionActiveAging = agingBucketFilters.length > 0;

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
    for (const lt of loanTypeFilters) {
      chips.push({
        key: `loanType:${lt}`,
        label: `Loan type: ${lt}`,
        onRemove: () => setLoanTypeFilters((p) => p.filter((x) => x !== lt)),
      });
    }
    for (const ab of agingBucketFilters) {
      chips.push({
        key: `aging:${ab}`,
        label: `Aging (active days): ${ab}`,
        onRemove: () => setAgingBucketFilters((p) => p.filter((x) => x !== ab)),
      });
    }
    return chips;
  }, [loanTypeFilters, agingBucketFilters]);

  const agingData = useMemo(
    () => [
      { range: "0-15", count: companyOverviewData?.aging?.["0-15"] || 0 },
      { range: "16-30", count: companyOverviewData?.aging?.["16-30"] || 0 },
      { range: "31-45", count: companyOverviewData?.aging?.["31-45"] || 0 },
      { range: "46-60", count: companyOverviewData?.aging?.["46-60"] || 0 },
      { range: "61-90", count: companyOverviewData?.aging?.["61-90"] || 0 },
      { range: ">90", count: companyOverviewData?.aging?.[">90"] || 0 },
    ],
    [companyOverviewData?.aging],
  );

  const submittedByType = useMemo(
    () => toLoanTypeData(companyOverviewData?.submittedByType),
    [companyOverviewData?.submittedByType],
  );
  const fundedByType = useMemo(
    () => toLoanTypeData(companyOverviewData?.fundedByType),
    [companyOverviewData?.fundedByType],
  );

  const monthLabel = useMemo(() => {
    const start = companyOverviewData?.window?.startDate;
    if (!start) return "Current month";
    return new Date(`${start}T00:00:00`).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  }, [companyOverviewData?.window?.startDate]);

  const submittedDateLabel =
    companyOverviewData?.definitions?.submittedDateField === "processing_date"
      ? "Processing Date"
      : "Submitted to Processing date";

  const kpis = [
    {
      title: "Active Loans",
      icon: Activity,
      accent: "from-blue-500 to-cyan-500",
      count: companyOverviewData?.activeLoans?.count || 0,
      volume: companyOverviewData?.activeLoans?.volume || 0,
      wac: companyOverviewData?.activeLoans?.avgInterestRate || 0,
      caption:
        "Active loans are open pipeline loans (not closed/funded/finalized adverse outcomes).",
    },
    {
      title: "Submitted Loans MTD",
      icon: CalendarDays,
      accent: "from-violet-500 to-blue-500",
      count: companyOverviewData?.submittedMTD?.count || 0,
      volume: companyOverviewData?.submittedMTD?.volume || 0,
      wac: companyOverviewData?.submittedMTD?.avgInterestRate || 0,
      caption:
        `Submitted MTD includes loans with ${submittedDateLabel} in the current month.`,
    },
    {
      title: "Funded Loans MTD",
      icon: BadgeDollarSign,
      accent: "from-emerald-500 to-teal-500",
      count: companyOverviewData?.fundedMTD?.count || 0,
      volume: companyOverviewData?.fundedMTD?.volume || 0,
      wac: companyOverviewData?.fundedMTD?.avgInterestRate || 0,
      caption:
        "Funded MTD includes loans with Funding date in the current month.",
    },
  ];

  return (
    <TopTieringLayout>
      <div className="flex flex-col min-h-[calc(100vh-4rem)]">
        <TopTieringTopBar title="Sales Company Overview" />
        <main className="flex-1 overflow-y-auto px-2 sm:px-4 py-2 sm:py-3">
          <div className="mx-auto max-w-[1800px] space-y-3 sm:space-y-4">
            <Card className={dashboardCardClass}>
              <CardContent className="p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/40 dark:text-blue-300">
                        Sales
                      </Badge>
                      <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                        {monthLabel}
                      </span>
                    </div>
                    <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                      Company Overview
                    </h1>
                    <p className="mt-1 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
                      Active pipeline, submitted-to-processing MTD, and funded MTD using dedicated Sales Company Overview definitions.
                    </p>
                    <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                      Click bars or donut slices to multi-select filters (KPIs update). Loan-type selections recalculate aging buckets to that loan-type cohort; age-bucket selections keep bars full-size with grey-out for non-selected buckets. When at least one age bucket is selected, MTD donut slices readjust to that cohort’s loan-type mix; loan-type-only filters keep full donut sizes with grey-out. Click a selected slice again to remove it.
                    </p>
                  </div>
                  {loading && (
                    <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Loading metrics
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {hasChartFilters && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-blue-100/80 bg-blue-50/50 px-3 py-2 dark:border-slate-700/80 dark:bg-slate-900/40">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Active filters</span>
                {activeFilterChips.map((chip) => (
                  <Badge
                    key={chip.key}
                    variant="secondary"
                    className="flex items-center gap-1 border border-blue-200/80 bg-white pr-1 text-xs font-medium text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <span className="max-w-[240px] truncate">{chip.label}</span>
                    <button
                      type="button"
                      onClick={chip.onRemove}
                      className="rounded-sm p-0.5 hover:bg-blue-100/80 dark:hover:bg-slate-700/80"
                      aria-label={`Remove ${chip.label}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={clearAllChartFilters}>
                  Clear all filters
                </Button>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              {kpis.map((kpi) => {
                const Icon = kpi.icon;
                return (
                  <Card key={kpi.title} className={`${dashboardCardClass} overflow-hidden`}>
                    <div className={`h-1 bg-gradient-to-r ${kpi.accent}`} />
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                            {kpi.title}
                          </CardTitle>
                          <div className="mt-2 text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
                            {loading ? "..." : kpi.count.toLocaleString()}
                          </div>
                        </div>
                        <div className={`rounded-xl bg-gradient-to-br ${kpi.accent} p-2.5 text-white shadow-lg`}>
                          <Icon className="h-5 w-5" />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3 dark:border-slate-700/60 dark:bg-slate-900/35">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Volume</p>
                          <p className="mt-1 text-xl font-bold text-cyan-700 dark:text-cyan-300">
                            {loading ? "..." : formatVolume(kpi.volume)}
                          </p>
                        </div>
                        <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3 dark:border-slate-700/60 dark:bg-slate-900/35">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">WAC</p>
                          <p className="mt-1 text-xl font-bold text-cyan-700 dark:text-cyan-300">
                            {loading ? "..." : formatWac(kpi.wac)}
                          </p>
                        </div>
                      </div>
                      <p className="mt-3 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-500 dark:border-slate-700/60 dark:text-slate-400">
                        {kpi.caption}
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
              <Card className={dashboardCardClass}>
                <CardHeader className={chartHeaderClass}>
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                      Aging of Active Loans
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="p-4">
                  <div className={overviewChartsRowHeightClass}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={agingData}
                        layout="vertical"
                        margin={{ top: 8, right: 20, left: 4, bottom: 8 }}
                        onClick={handleAgingBarChartClick}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis
                          type="number"
                          tick={{ fontSize: 11, fill: "#64748b" }}
                          axisLine={false}
                          tickLine={false}
                          label={{
                            value: "Loan Count",
                            position: "insideBottom",
                            offset: -4,
                            fill: "#64748b",
                            fontSize: 11,
                          }}
                        />
                        <YAxis
                          type="category"
                          dataKey="range"
                          width={58}
                          tick={{ fontSize: 11, fill: "#64748b" }}
                          axisLine={false}
                          tickLine={false}
                          label={{
                            value: "Age Bucket (Days)",
                            angle: -90,
                            position: "insideLeft",
                            fill: "#64748b",
                            fontSize: 11,
                            offset: 0,
                          }}
                        />
                        <Tooltip
                          cursor={{ fill: "rgba(59,130,246,0.08)" }}
                          content={({ active, payload, label }) => {
                            if (!active || !payload?.length) return null;
                            return (
                              <div className={tooltipClass}>
                                <p className="font-semibold text-slate-900 dark:text-slate-100">{label} days</p>
                                <p className="mt-1 text-slate-500 dark:text-slate-400">
                                  {Number(payload[0].value || 0).toLocaleString()} active loans
                                </p>
                              </div>
                            );
                          }}
                        />
                        <Bar dataKey="count" radius={[0, 6, 6, 0]} className="cursor-pointer">
                          {agingData.map((entry) => {
                            const dimmed =
                              chartSelectionActiveAging && !agingBucketFilters.includes(entry.range as SalesCompanyOverviewAgingBucket);
                            return (
                              <Cell
                                key={entry.range}
                                fill={dimmed ? CHART_DEEMPHASIS_FILL : AGING_COLORS[entry.range] || "#64748b"}
                              />
                            );
                          })}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card className={dashboardCardClass}>
                <CardHeader className={chartHeaderClass}>
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                      Loan Type MTD Submitted
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="p-4">
                  <div className={overviewChartsRowHeightClass}>
                    {submittedByType.length > 0 ? (
                      <LoanTypeDonutChart
                        data={submittedByType}
                        tooltipClassName={tooltipClass}
                        selectedLoanTypes={loanTypeFilters}
                        onSliceClick={toggleLoanType}
                      />
                    ) : (
                      <EmptyChartState label="No submitted MTD loan type data" />
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className={dashboardCardClass}>
                <CardHeader className={chartHeaderClass}>
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                      Loan Type MTD Funded
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="p-4">
                  <div className={overviewChartsRowHeightClass}>
                    {fundedByType.length > 0 ? (
                      <LoanTypeDonutChart
                        data={fundedByType}
                        tooltipClassName={tooltipClass}
                        selectedLoanTypes={loanTypeFilters}
                        onSliceClick={toggleLoanType}
                      />
                    ) : (
                      <EmptyChartState label="No funded MTD loan type data" />
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </main>
      </div>
    </TopTieringLayout>
  );
};

export default SalesCompanyOverview;
