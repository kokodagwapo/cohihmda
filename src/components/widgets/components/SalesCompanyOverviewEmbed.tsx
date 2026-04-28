import React, { useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, BadgeDollarSign, CalendarDays } from "lucide-react";
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
import { useCanvasDataStore } from "@/stores/canvasDataStore";
import { useWidgetSectionStore } from "@/stores/widgetSectionStore";
import { cn } from "@/lib/utils";
import type { WidgetRenderProps } from "../registry/types";
import type { SalesCompanyOverviewAgingBucket, SalesCompanyOverviewData } from "@/hooks/useSalesCompanyOverviewData";

type Variant =
  | "kpi-active"
  | "kpi-submitted"
  | "kpi-funded"
  | "aging-chart"
  | "submitted-type-chart"
  | "funded-type-chart";

type LoanTypeDatum = { name: string; count: number; percent: number; fill: string };

const TYPE_COLORS = ["#312e81", "#14b8a6", "#7dd3fc", "#15803d", "#f97316", "#e11d48", "#9333ea"];
const AGING_COLORS: Record<string, string> = {
  "0-15": "#14b8a6",
  "16-30": "#3b82f6",
  "31-45": "#6366f1",
  "46-60": "#f59e0b",
  "61-90": "#f97316",
  ">90": "#ef4444",
};
const AGING_BUCKET_KEYS = new Set<string>(["0-15", "16-30", "31-45", "46-60", "61-90", ">90"]);
const CHART_DEEMPHASIS_FILL = "#cbd5e1";

function formatVolume(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toLocaleString()}`;
}

function formatWac(value: number): string {
  return `${(value || 0).toFixed(3)}%`;
}

function toLoanTypeData(values?: Record<string, number>): LoanTypeDatum[] {
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
}

function LoanTypeDonut({
  data,
  selectedLoanTypes,
  onToggle,
}: {
  data: LoanTypeDatum[];
  selectedLoanTypes: string[];
  onToggle: (name: string) => void;
}) {
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
              className="cursor-pointer [&_path]:outline-none"
              onClick={(sliceProps: unknown) => {
                const p = sliceProps as { name?: string; payload?: { name?: string } };
                const name = p?.payload?.name ?? p?.name;
                if (name) onToggle(String(name));
              }}
            >
              {data.map((entry) => {
                const dimmed = selectionActive && !selectedLoanTypes.includes(entry.name);
                return <Cell key={entry.name} fill={dimmed ? CHART_DEEMPHASIS_FILL : entry.fill} />;
              })}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="shrink-0 border-t border-slate-100/90 px-1 pt-1.5 dark:border-slate-700/70">
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          {data.map((d) => {
            const isSelected = selectedLoanTypes.includes(d.name);
            const dimmed = selectionActive && !isSelected;
            return (
              <button
                key={d.name}
                type="button"
                onClick={() => onToggle(d.name)}
                className={cn(
                  "flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left text-[10px]",
                  dimmed && "opacity-40",
                  isSelected && "bg-blue-50 dark:bg-slate-800",
                )}
              >
                <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: dimmed ? CHART_DEEMPHASIS_FILL : d.fill }} />
                <span className="truncate">{d.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  title,
  icon: Icon,
  count,
  volume,
  wac,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  volume: number;
  wac: number;
}) {
  return (
    <Card className="h-full rounded-xl border-slate-200/70 dark:border-slate-700/60">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm">{title}</CardTitle>
          <Icon className="h-4 w-4 text-slate-500" />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        <div className="text-3xl font-bold">{count.toLocaleString()}</div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded border border-slate-200/70 p-2 dark:border-slate-700/60">
            <div className="text-slate-500">Volume</div>
            <div className="font-semibold">{formatVolume(volume)}</div>
          </div>
          <div className="rounded border border-slate-200/70 p-2 dark:border-slate-700/60">
            <div className="text-slate-500">WAC</div>
            <div className="font-semibold">{formatWac(wac)}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SalesCompanyOverviewEmbedInner({ data, loading, width, height, config }: WidgetRenderProps) {
  const variant = ((config?.variant as Variant) || "aging-chart") as Variant;
  const groupId = (config?.groupId as string | undefined) ?? null;
  const canvasItemId = config?.canvasItemId as string | undefined;
  const source = (data as SalesCompanyOverviewData | null) ?? null;
  const reportWidgetData = useCanvasDataStore((s) => s.reportWidgetData);
  const filters = useWidgetSectionStore((s) => (groupId ? s.getFilters(groupId) : null));
  const updateFilters = useWidgetSectionStore((s) => s.updateFilters);

  const selectedLoanTypes = useMemo(
    () => filters?.salesCompanyOverviewLoanTypes ?? [],
    [filters?.salesCompanyOverviewLoanTypes],
  );
  const selectedAgingBuckets = useMemo(
    () => filters?.salesCompanyOverviewAgingBuckets ?? [],
    [filters?.salesCompanyOverviewAgingBuckets],
  );

  const toggleLoanType = useCallback((name: string) => {
    if (!groupId) return;
    const set = new Set(selectedLoanTypes);
    if (set.has(name)) set.delete(name);
    else set.add(name);
    updateFilters(groupId, { salesCompanyOverviewLoanTypes: [...set].sort((a, b) => a.localeCompare(b)) });
  }, [groupId, selectedLoanTypes, updateFilters]);

  const toggleAgingBucket = useCallback((range: string) => {
    if (!groupId || !AGING_BUCKET_KEYS.has(range)) return;
    const key = range as SalesCompanyOverviewAgingBucket;
    const set = new Set(selectedAgingBuckets);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    updateFilters(groupId, { salesCompanyOverviewAgingBuckets: [...set].sort((a, b) => a.localeCompare(b)) as SalesCompanyOverviewAgingBucket[] });
  }, [groupId, selectedAgingBuckets, updateFilters]);

  const agingData = useMemo(
    () => [
      { range: "0-15", count: source?.aging?.["0-15"] || 0 },
      { range: "16-30", count: source?.aging?.["16-30"] || 0 },
      { range: "31-45", count: source?.aging?.["31-45"] || 0 },
      { range: "46-60", count: source?.aging?.["46-60"] || 0 },
      { range: "61-90", count: source?.aging?.["61-90"] || 0 },
      { range: ">90", count: source?.aging?.[">90"] || 0 },
    ],
    [source?.aging],
  );
  const submittedByType = useMemo(() => toLoanTypeData(source?.submittedByType), [source?.submittedByType]);
  const fundedByType = useMemo(() => toLoanTypeData(source?.fundedByType), [source?.fundedByType]);

  React.useEffect(() => {
    if (!canvasItemId || loading) return;
    reportWidgetData(canvasItemId, {
      widgetName: String(config?.definitionName ?? "Sales Company Overview"),
      category: variant.includes("kpi") ? "kpi" : "chart",
      data: {
        variant,
        agingData,
        submittedByType,
        fundedByType,
        activeLoans: source?.activeLoans ?? null,
        submittedMTD: source?.submittedMTD ?? null,
        fundedMTD: source?.fundedMTD ?? null,
      },
    });
  }, [canvasItemId, loading, reportWidgetData, config?.definitionName, variant, agingData, submittedByType, fundedByType, source?.activeLoans, source?.submittedMTD, source?.fundedMTD]);

  if (loading) return <div className="h-full w-full grid place-items-center text-xs text-slate-500">Loading...</div>;
  if (!source) return <div className="h-full w-full grid place-items-center text-xs text-slate-500">No data</div>;

  if (variant === "kpi-active") {
    return <KpiCard title="Active Loans" icon={Activity} count={source.activeLoans?.count || 0} volume={source.activeLoans?.volume || 0} wac={source.activeLoans?.avgInterestRate || 0} />;
  }
  if (variant === "kpi-submitted") {
    return <KpiCard title="Submitted Loans MTD" icon={CalendarDays} count={source.submittedMTD?.count || 0} volume={source.submittedMTD?.volume || 0} wac={source.submittedMTD?.avgInterestRate || 0} />;
  }
  if (variant === "kpi-funded") {
    return <KpiCard title="Funded Loans MTD" icon={BadgeDollarSign} count={source.fundedMTD?.count || 0} volume={source.fundedMTD?.volume || 0} wac={source.fundedMTD?.avgInterestRate || 0} />;
  }

  if (variant === "aging-chart") {
    const selectionActive = selectedAgingBuckets.length > 0;
    return (
      <Card className="h-full rounded-xl border-slate-200/70 dark:border-slate-700/60">
        <CardHeader className="pb-1"><CardTitle className="text-sm">Aging of Active Loans</CardTitle></CardHeader>
        <CardContent className="h-[calc(100%-2.5rem)] p-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={agingData}
              layout="vertical"
              margin={{ top: 6, right: 14, left: 4, bottom: 6 }}
              onClick={(state: unknown) => {
                const s = state as { activePayload?: Array<{ payload?: { range?: string } }> } | null;
                const range = s?.activePayload?.[0]?.payload?.range;
                if (range) toggleAgingBucket(range);
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="range" width={56} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="count" radius={[0, 5, 5, 0]} className="cursor-pointer">
                {agingData.map((entry) => {
                  const dimmed = selectionActive && !selectedAgingBuckets.includes(entry.range as SalesCompanyOverviewAgingBucket);
                  return <Cell key={entry.range} fill={dimmed ? CHART_DEEMPHASIS_FILL : AGING_COLORS[entry.range] || "#64748b"} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    );
  }

  const typeData = variant === "submitted-type-chart" ? submittedByType : fundedByType;
  const title = variant === "submitted-type-chart" ? "Loan Type MTD Submitted" : "Loan Type MTD Funded";
  return (
    <Card className="h-full rounded-xl border-slate-200/70 dark:border-slate-700/60">
      <CardHeader className="pb-1"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="h-[calc(100%-2.5rem)] p-2">
        {typeData.length > 0 ? (
          <LoanTypeDonut data={typeData} selectedLoanTypes={selectedLoanTypes} onToggle={toggleLoanType} />
        ) : (
          <div className="h-full w-full grid place-items-center text-xs text-slate-500">No data</div>
        )}
      </CardContent>
    </Card>
  );
}

export const SalesCompanyOverviewEmbed = React.memo(SalesCompanyOverviewEmbedInner);
