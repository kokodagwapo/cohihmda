import React, { useMemo } from "react";
import {
  BarChart,
  Bar,
  Cell,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  LineChart,
  Line,
} from "recharts";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { WidgetRenderProps } from "../registry/types";
import {
  useProductionTrendsData,
  type ProductionDateType,
  type ProductionDimension,
  type ProductionDrilldownRow,
  type ProductionDrilldownSlice,
  type ProductionMeasure,
} from "@/hooks/useProductionTrendsData";
import { useTenantStore } from "@/stores/tenantStore";
import { useChannelStore } from "@/stores/channelStore";
import { useAuth } from "@/contexts/AuthContext";
import { useWidgetSectionStore } from "@/stores/widgetSectionStore";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const CHART_DEEMPHASIS_FILL = "#cbd5e1";

function formatMeasure(value: number, measure: ProductionMeasure): string {
  if (measure === "volume") {
    if (Math.abs(value) >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
    if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
    return `$${Math.round(value).toLocaleString()}`;
  }
  return Math.round(value).toLocaleString();
}

function monthLabel(month: number): string {
  return new Date(Date.UTC(2020, month - 1, 1)).toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
}

function toDrilldownSlice(level: number, label: string): ProductionDrilldownSlice | null {
  if (!label) return null;
  if (level === 0) return { branches: [label], lienPositions: [], productTypes: [], loanPrograms: [] };
  if (level === 1) return { branches: [], lienPositions: [label], productTypes: [], loanPrograms: [] };
  if (level === 2) return { branches: [], lienPositions: [], productTypes: [label], loanPrograms: [] };
  if (level === 3) return { branches: [], lienPositions: [], productTypes: [], loanPrograms: [label] };
  return null;
}

function rowMatchesDrilldownSlice(
  row: { depth: number; label: string },
  d: ProductionDrilldownSlice | null,
): boolean {
  if (!d) return false;
  if (row.depth === 0) return d.branches.includes(row.label);
  if (row.depth === 1) return d.lienPositions.includes(row.label);
  if (row.depth === 2) return d.productTypes.includes(row.label);
  if (row.depth === 3) return d.loanPrograms.includes(row.label);
  return false;
}

function DrilldownRows({
  rows,
  turnTimeLabel,
  sliceDrilldown,
  onRowFilterClick,
}: {
  rows: ProductionDrilldownRow[];
  turnTimeLabel: string;
  sliceDrilldown: ProductionDrilldownSlice | null;
  onRowFilterClick: (row: { depth: number; label: string }) => void;
}) {
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const byParent = useMemo(() => {
    const m = new Map<string | null, typeof rows>();
    for (const row of rows) {
      const list = m.get(row.parentId) || [];
      list.push(row);
      m.set(row.parentId, list);
    }
    return m;
  }, [rows]);

  React.useEffect(() => {
    setExpanded(new Set());
  }, [rows]);

  const idsWithChildren = useMemo(
    () => rows.filter((r) => (byParent.get(r.id) || []).length > 0).map((r) => r.id),
    [rows, byParent],
  );

  const visibleRows = useMemo(() => {
    const out: typeof rows = [];
    const walk = (parentId: string | null) => {
      const children = byParent.get(parentId) || [];
      children.forEach((child) => {
        out.push(child);
        if (expanded.has(child.id)) walk(child.id);
      });
    };
    walk(null);
    return out;
  }, [byParent, expanded]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setExpanded(new Set(idsWithChildren))}>
          Expand All
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setExpanded(new Set())}>
          Collapse All
        </Button>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-700">
            <th className="px-2 py-2 text-left">Group</th>
            <th className="px-2 py-2 text-right">Units</th>
            <th className="px-2 py-2 text-right">Volume</th>
            <th className="px-2 py-2 text-right">Avg Loan Amt</th>
            <th className="px-2 py-2 text-right">Avg LTV</th>
            <th className="px-2 py-2 text-right">WAC</th>
            <th className="px-2 py-2 text-right">{turnTimeLabel}</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => {
            const hasChildren = (byParent.get(row.id) || []).length > 0;
            const rowSelected = rowMatchesDrilldownSlice(row, sliceDrilldown);
            return (
              <tr
                key={row.id}
                className={cn(
                  "border-b border-slate-100 dark:border-slate-800 cursor-pointer hover:bg-slate-50/90 dark:hover:bg-slate-800/50",
                  rowSelected && "bg-blue-50/80 dark:bg-slate-800/80",
                )}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("button")) return;
                  onRowFilterClick(row);
                }}
              >
                <td className="px-2 py-2">
                  <div className="flex items-center gap-1" style={{ paddingLeft: `${row.depth * 16}px` }}>
                    {hasChildren ? (
                      <button
                        type="button"
                        className="rounded p-0.5 hover:bg-slate-100 dark:hover:bg-slate-700"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(row.id);
                        }}
                      >
                        {expanded.has(row.id) ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </button>
                    ) : (
                      <span className="inline-block w-4" />
                    )}
                    <span className={row.depth <= 1 ? "font-semibold text-slate-800 dark:text-slate-200" : "text-slate-700 dark:text-slate-300"}>
                      {row.label}
                    </span>
                  </div>
                </td>
                <td className="px-2 py-2 text-right">{formatMeasure(row.units, "units")}</td>
                <td className="px-2 py-2 text-right">{formatMeasure(row.volume, "volume")}</td>
                <td className="px-2 py-2 text-right">{formatMeasure(row.avgLoanAmount, "volume")}</td>
                <td className="px-2 py-2 text-right">{row.avgLtv == null ? "-" : `${row.avgLtv.toFixed(1)}%`}</td>
                <td className="px-2 py-2 text-right">{row.wac == null ? "-" : row.wac.toFixed(3)}</td>
                <td className="px-2 py-2 text-right">{row.avgTurnTime == null ? "-" : `${row.avgTurnTime.toFixed(1)} days`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ProductionTrendsEmbedInner({ width, height, config }: WidgetRenderProps) {
  const groupId = (config?.groupId as string) ?? "";
  const variant = (config?.variant as "yoy" | "largest" | "line" | "drilldown") ?? "yoy";

  const section = useWidgetSectionStore((s) => s.sections[groupId]);
  const updateFilters = useWidgetSectionStore((s) => s.updateFilters);

  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();
  const { user } = useAuth();
  const tenantId = selectedTenantId || user?.tenant_id || null;

  const dateType = (section?.productionTrendsDateType ?? "funded") as ProductionDateType;
  const measure = (section?.productionTrendsMeasure ?? "volume") as ProductionMeasure;
  const dimension = (section?.productionTrendsDimension ?? "branch") as ProductionDimension;
  const yearMonths = section?.productionTrendsYearMonths ?? [];
  const sliceCategories = section?.productionTrendsSliceCategories ?? [];
  const sliceLineMonths = section?.productionTrendsSliceLineMonths ?? [];
  const sliceDrilldown = section?.productionTrendsSliceDrilldown ?? null;

  const { data, loading, error } = useProductionTrendsData({
    dateType,
    measure,
    dimension,
    yearMonths,
    tenantId,
    channelGroup: selectedChannel,
    sliceFilters:
      sliceCategories.length || sliceLineMonths.length || sliceDrilldown
        ? {
            dimensionCategories: sliceCategories,
            lineMonths: sliceLineMonths,
            drilldown: sliceDrilldown,
          }
        : null,
  });

  const rootStyle = useMemo(
    () => ({ width, minHeight: height }),
    [width, height],
  );

  const toggleCategory = (category: string) => {
    const prev = section?.productionTrendsSliceCategories ?? [];
    const s = new Set(prev);
    if (s.has(category)) s.delete(category);
    else s.add(category);
    updateFilters(groupId, {
      productionTrendsSliceCategories: [...s].sort((a, b) => a.localeCompare(b)),
    });
  };

  const toggleLineMonth = (month: number) => {
    const prev = section?.productionTrendsSliceLineMonths ?? [];
    const s = new Set(prev);
    if (s.has(month)) s.delete(month);
    else s.add(month);
    updateFilters(groupId, {
      productionTrendsSliceLineMonths: [...s].sort((a, b) => a - b),
    });
  };

  const toggleDrilldown = (depth: number, label: string) => {
    const curr = section?.productionTrendsSliceDrilldown;
    const next = toDrilldownSlice(depth, label);
    const same =
      JSON.stringify(curr ?? null) === JSON.stringify(next ?? null) ? null : next;
    updateFilters(groupId, { productionTrendsSliceDrilldown: same });
  };

  return (
    <div className="h-full w-full overflow-auto bg-white dark:bg-slate-900/80 rounded-lg p-3" style={rootStyle}>
      {loading ? (
        <div className="h-full flex items-center justify-center text-xs text-slate-500">Loading Production Trends…</div>
      ) : error ? (
        <div className="h-full flex items-center justify-center text-xs text-red-500">{error}</div>
      ) : !data ? (
        <div className="h-full flex items-center justify-center text-xs text-slate-500">No data</div>
      ) : variant === "yoy" ? (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th className="py-2 text-left">Time Range</th>
              <th className="py-2 text-right">{data.currentYear}</th>
              <th className="py-2 text-right">{data.previousYear}</th>
              <th className="py-2 text-right">YoY %</th>
            </tr>
          </thead>
          <tbody>
            {data.yoyComparison.map((row) => (
              <tr key={row.timeRange} className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-2">{row.timeRange}</td>
                <td className="py-2 text-right">{formatMeasure(row.currentYear, measure)}</td>
                <td className="py-2 text-right">{formatMeasure(row.previousYear, measure)}</td>
                <td className="py-2 text-right">{row.yoyPercent == null ? "-" : `${row.yoyPercent.toFixed(1)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : variant === "largest" ? (
        <div className="h-full min-h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.largestCategory.rows} onClick={(s: any) => s?.activePayload?.[0]?.payload?.category && toggleCategory(String(s.activePayload[0].payload.category))}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="category" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={80} />
              <YAxis tickFormatter={(v) => formatMeasure(Number(v || 0), measure)} />
              <Tooltip formatter={(v: any) => formatMeasure(Number(v || 0), measure)} />
              <Bar dataKey={measure} radius={[4, 4, 0, 0]} className="cursor-pointer">
                {data.largestCategory.rows.map((entry) => {
                  const dimmed = sliceCategories.length > 0 && !sliceCategories.includes(entry.category);
                  return <Cell key={entry.category} fill={dimmed ? CHART_DEEMPHASIS_FILL : "#0ea5e9"} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : variant === "line" ? (
        <div className="h-full min-h-[260px]">
          {data.yoySeries[0] ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.yoySeries[0].points.map((p) => ({ ...p, monthLabel: monthLabel(p.month) }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="monthLabel" />
                <YAxis tickFormatter={(v) => formatMeasure(Number(v || 0), measure)} />
                <Tooltip formatter={(v: any) => formatMeasure(Number(v || 0), measure)} />
                <Line
                  type="monotone"
                  dataKey="currentValue"
                  name={String(data.yoySeries[0].currentYear)}
                  stroke="#0ea5e9"
                  strokeWidth={2}
                  dot={(props: any) => {
                    const month = Number(props?.payload?.month ?? 0);
                    const dimmed = sliceLineMonths.length > 0 && !sliceLineMonths.includes(month);
                    return (
                      <g>
                        <circle cx={props.cx} cy={props.cy} r={3} fill={dimmed ? CHART_DEEMPHASIS_FILL : "#0ea5e9"} />
                        <circle
                          cx={props.cx}
                          cy={props.cy}
                          r={10}
                          fill="transparent"
                          className="cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (month >= 1 && month <= 12) toggleLineMonth(month);
                          }}
                        />
                      </g>
                    );
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="previousValue"
                  name={String(data.yoySeries[0].previousYear)}
                  stroke="#64748b"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-slate-500">No year pairs available</div>
          )}
        </div>
      ) : (
        <div className="overflow-auto">
          <DrilldownRows
            rows={data.drilldown.rows}
            turnTimeLabel={data.drilldown.turnTimeLabel}
            sliceDrilldown={sliceDrilldown}
            onRowFilterClick={(row) => toggleDrilldown(row.depth, row.label)}
          />
        </div>
      )}
    </div>
  );
}

export const ProductionTrendsEmbed = React.memo(ProductionTrendsEmbedInner);

