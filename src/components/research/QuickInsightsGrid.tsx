/**
 * QuickInsightsGrid
 *
 * Auto-generated visualization cards from upload metadata.
 * Uses Recharts to render bar, line, pie, scatter, and histogram charts
 * based on suggested QuickInsightConfig entries.
 */

import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { useMemo } from "react";
import { BarChart2, TrendingUp, PieChart as PieIcon, Activity, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResearchUpload, QuickInsightConfig, ColumnMeta } from "@/hooks/useResearchUploads";

const CHART_COLORS = [
  "#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444",
  "#06b6d4", "#84cc16", "#ec4899", "#f97316", "#6366f1",
];

// ============================================================================
// Data preparation
// ============================================================================

function buildChartData(
  config: QuickInsightConfig,
  rows: Record<string, any>[],
  columns: ColumnMeta[]
): any[] {
  if (!rows || rows.length === 0) return [];

  const colMap = new Map(columns.map((c) => [c.name, c]));

  switch (config.chartType) {
    case "bar": {
      if (!config.xKey || !config.yKey) return [];
      const grouped = new Map<string, number[]>();
      for (const row of rows) {
        const k = String(row[config.xKey] ?? "Unknown");
        const v = Number(row[config.yKey]);
        if (!isNaN(v)) {
          if (!grouped.has(k)) grouped.set(k, []);
          grouped.get(k)!.push(v);
        }
      }
      return Array.from(grouped.entries())
        .map(([name, vals]) => ({
          name,
          value: vals.reduce((a, b) => a + b, 0) / vals.length,
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 15);
    }

    case "line": {
      if (!config.xKey || !config.yKey) return [];
      const colMeta = colMap.get(config.xKey);
      const isDate = colMeta?.isDate;
      const sorted = [...rows]
        .filter((r) => r[config.xKey!] != null && r[config.yKey!] != null)
        .sort((a, b) => {
          const av = a[config.xKey!];
          const bv = b[config.xKey!];
          if (isDate) return new Date(av).getTime() - new Date(bv).getTime();
          return String(av).localeCompare(String(bv));
        });
      return sorted.slice(0, 50).map((r) => ({
        name: isDate ? new Date(r[config.xKey!]).toLocaleDateString() : String(r[config.xKey!]),
        value: Number(r[config.yKey!]),
      }));
    }

    case "pie": {
      if (!config.nameKey) return [];
      const counts = new Map<string, number>();
      for (const row of rows) {
        const k = String(row[config.nameKey] ?? "Unknown");
        counts.set(k, (counts.get(k) || 0) + 1);
      }
      return Array.from(counts.entries())
        .map(([name, count]) => ({ name, value: count }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8);
    }

    case "histogram": {
      if (!config.xKey) return [];
      const values = rows.map((r) => Number(r[config.xKey!])).filter((v) => !isNaN(v));
      if (values.length === 0) return [];
      const min = Math.min(...values);
      const max = Math.max(...values);
      const BUCKETS = Math.min(20, Math.ceil(values.length / 10));
      if (min === max) return [{ name: String(min), count: values.length }];
      const step = (max - min) / BUCKETS;
      const buckets: { name: string; count: number }[] = [];
      for (let i = 0; i < BUCKETS; i++) {
        const lo = min + i * step;
        const hi = lo + step;
        const count = values.filter((v) => v >= lo && (i === BUCKETS - 1 ? v <= hi : v < hi)).length;
        buckets.push({ name: lo.toFixed(1), count });
      }
      return buckets;
    }

    case "scatter": {
      if (!config.xKey || !config.yKey) return [];
      return rows
        .filter((r) => r[config.xKey!] != null && r[config.yKey!] != null)
        .slice(0, 200)
        .map((r) => ({
          x: Number(r[config.xKey!]),
          y: Number(r[config.yKey!]),
        }))
        .filter((p) => !isNaN(p.x) && !isNaN(p.y));
    }

    default:
      return [];
  }
}

// ============================================================================
// Chart icon
// ============================================================================

function ChartIcon({ type }: { type: QuickInsightConfig["chartType"] }) {
  switch (type) {
    case "line": return <TrendingUp className="w-4 h-4" />;
    case "pie": return <PieIcon className="w-4 h-4" />;
    case "scatter": return <Activity className="w-4 h-4" />;
    default: return <BarChart2 className="w-4 h-4" />;
  }
}

// ============================================================================
// Individual chart card
// ============================================================================

function InsightCard({
  config,
  data,
  columns,
}: {
  config: QuickInsightConfig;
  data: any[];
  columns: ColumnMeta[];
}) {
  const colMap = new Map(columns.map((c) => [c.name, c]));

  const xColMeta = config.xKey ? colMap.get(config.xKey) : undefined;
  const yColMeta = config.yKey ? colMap.get(config.yKey) : undefined;

  const xLabel = xColMeta?.displayName || config.xKey || "";
  const yLabel = yColMeta?.displayName || config.yKey || "";

  if (data.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 min-h-[240px]">
        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
          <ChartIcon type={config.chartType} />
          <span className="text-sm font-medium">{config.title}</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <AlertCircle className="w-3.5 h-3.5" />
            No data available
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
          <ChartIcon type={config.chartType} />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{config.title}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">{config.description}</p>
        </div>
      </div>

      <div className="h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          {config.chartType === "bar" || config.chartType === "histogram" ? (
            <BarChart data={data} margin={{ top: 4, right: 8, bottom: 20, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                angle={data.length > 8 ? -30 : 0}
                textAnchor={data.length > 8 ? "end" : "middle"}
                label={config.chartType === "histogram" ? { value: xLabel, position: "insideBottom", offset: -10, fontSize: 10, fill: "#94a3b8" } : undefined}
              />
              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} width={40} />
              <Tooltip
                contentStyle={{ fontSize: 11, borderRadius: 8 }}
                formatter={(v: any) => [typeof v === "number" ? v.toLocaleString() : v]}
              />
              <Bar dataKey={config.chartType === "histogram" ? "count" : "value"} fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} />
            </BarChart>
          ) : config.chartType === "line" ? (
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 20, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} angle={-30} textAnchor="end" />
              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} width={40} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              <Line type="monotone" dataKey="value" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} />
            </LineChart>
          ) : config.chartType === "pie" ? (
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`} labelLine={false}>
                {data.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
            </PieChart>
          ) : config.chartType === "scatter" ? (
            <ScatterChart margin={{ top: 4, right: 8, bottom: 20, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="x" name={xLabel} tick={{ fontSize: 10, fill: "#94a3b8" }} />
              <YAxis dataKey="y" name={yLabel} tick={{ fontSize: 10, fill: "#94a3b8" }} width={40} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} cursor={{ strokeDasharray: "3 3" }} />
              <Scatter data={data} fill={CHART_COLORS[0]} opacity={0.6} />
            </ScatterChart>
          ) : (
            <BarChart data={data}><Bar dataKey="value" /></BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ============================================================================
// Main grid
// ============================================================================

interface QuickInsightsGridProps {
  upload: ResearchUpload;
  className?: string;
}

export function QuickInsightsGrid({ upload, className }: QuickInsightsGridProps) {
  const chartData = useMemo(() => {
    return upload.quickInsights.map((config) => ({
      config,
      data: buildChartData(config, upload.sampleRows, upload.columns),
    }));
  }, [upload.quickInsights, upload.sampleRows, upload.columns]);

  if (chartData.length === 0) return null;

  return (
    <div className={cn("space-y-3", className)}>
      <div>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Quick Insights</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Auto-generated visualizations based on detected column types.
          {upload.rowCount > upload.sampleRows.length && (
            <> Charts are based on {upload.sampleRows.length} preview rows. Full analysis available in Research Lab.</>
          )}
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {chartData.map(({ config, data }, idx) => (
          <InsightCard
            key={idx}
            config={config}
            data={data}
            columns={upload.columns}
          />
        ))}
      </div>
    </div>
  );
}
