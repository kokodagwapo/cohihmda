/**
 * Registry definitions for migrated legacy canvas payloads (chart/kpi/table/pinned_insight).
 */
import { Lightbulb } from "lucide-react";
import type { WidgetDefinition } from "./types";
import { EnhancedVisualization } from "@/components/visualizations/EnhancedVisualization";
import {
  ChartShell,
  normalizeChartCardType,
} from "@/components/widgets/components/ChartShell";
import type { ChartCardChartType } from "@/components/widgets/components/ChartTypeStrip";

export const WORKBENCH_LEGACY_CHART_ID = "workbench-legacy-chart";
export const WORKBENCH_LEGACY_KPI_ID = "workbench-legacy-kpi";
export const WORKBENCH_LEGACY_TABLE_ID = "workbench-legacy-table";
export const WORKBENCH_LEGACY_PINNED_ID = "workbench-legacy-pinned-insight";

type LegacyConfig = Record<string, unknown> & {
  vizConfig?: Record<string, unknown>;
  chartType?: string;
  label?: string;
  value?: number | string;
  format?: "number" | "currency" | "percent";
  columns?: { key: string; label: string }[];
  data?: Record<string, unknown>[];
  title?: string;
  content?: string;
  visualization?: Record<string, unknown>;
};

function LegacyChartEmbed({
  config,
  width,
  height,
  onConfigChange,
}: {
  config?: LegacyConfig;
  width?: number;
  height?: number;
  onConfigChange?: (config: Record<string, unknown>) => void;
}) {
  const viz = (config?.vizConfig ?? config) as Record<string, unknown>;
  const chartType = normalizeChartCardType(
    config?.chartType ?? viz?.type,
  );
  const effectiveConfig = { ...viz, type: chartType };

  return (
    <ChartShell
      showChartTypeStrip={!!onConfigChange}
      chartType={chartType as ChartCardChartType}
      onChartTypeChange={(type) =>
        onConfigChange?.({
          ...(config ?? {}),
          chartType: type,
          vizConfig: { ...viz, type },
        })
      }
    >
      <div className="h-full w-full p-2 overflow-auto">
        <EnhancedVisualization
          config={{
            ...effectiveConfig,
            animated: true,
            drilldownEnabled: false,
          }}
          height={Math.max(120, (height ?? 200) - 40)}
          showInsights={false}
        />
      </div>
    </ChartShell>
  );
}

function LegacyKpiEmbed({ config }: { config?: LegacyConfig }) {
  const label = config?.label ?? "KPI";
  const value = config?.value ?? "—";
  const format = config?.format;
  const formatted =
    format === "currency"
      ? typeof value === "number"
        ? new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 0,
          }).format(value)
        : String(value)
      : format === "percent"
        ? `${Number(value)}%`
        : String(value);
  return (
    <div className="h-full w-full p-4 flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200/70 dark:border-slate-700/70">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
        {label}
      </p>
      <p className="text-xl font-semibold text-slate-900 dark:text-white mt-1">
        {formatted}
      </p>
    </div>
  );
}

function LegacyTableEmbed({ config }: { config?: LegacyConfig }) {
  const data = config?.data ?? [];
  const columns =
    config?.columns ??
    (data[0] ? Object.keys(data[0]).map((k) => ({ key: k, label: k })) : []);
  if (!data.length) {
    return (
      <div className="h-full w-full flex items-center justify-center text-xs text-slate-400">
        No table data
      </div>
    );
  }
  return (
    <div className="h-full w-full overflow-auto p-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-700">
            {columns.map((col) => (
              <th
                key={col.key}
                className="text-left py-2 px-2 font-medium text-slate-600 dark:text-slate-400"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={i}
              className="border-b border-slate-100 dark:border-slate-800"
            >
              {columns.map((col) => (
                <td key={col.key} className="py-2 px-2 text-slate-700 dark:text-slate-300">
                  {String((row as Record<string, unknown>)[col.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LegacyPinnedEmbed({ config }: { config?: LegacyConfig }) {
  const title = config?.title ?? "Insight";
  const content = config?.content ?? "";
  const visualization = config?.visualization as
    | { data?: unknown[] }
    | undefined;
  const hasViz = visualization && (visualization.data?.length ?? 0) > 0;
  return (
    <div className="h-full w-full p-3 overflow-auto rounded-xl border border-slate-200/70 dark:border-slate-700/70 bg-white/80 dark:bg-slate-800/50 flex flex-col">
      <div className="flex items-center gap-2 mb-2 shrink-0">
        <Lightbulb className="w-4 h-4 text-amber-500 shrink-0" />
        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
          {title}
        </p>
      </div>
      {hasViz ? (
        <>
          <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 mb-2 shrink-0">
            {content}
          </p>
          <div className="flex-1 min-h-0">
            <EnhancedVisualization
              config={{
                ...(visualization as object),
                animated: true,
                drilldownEnabled: false,
              }}
              height={120}
              showInsights={false}
            />
          </div>
        </>
      ) : (
        <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-4">
          {content}
        </p>
      )}
    </div>
  );
}

const legacySentinel = () => ({ ready: true });

export const legacyWorkbenchWidgets: WidgetDefinition[] = [
  {
    id: WORKBENCH_LEGACY_CHART_ID,
    name: "Legacy chart",
    description: "Migrated static chart snapshot",
    category: "chart",
    group: "Workbench legacy",
    dataSource: "workbench-legacy",
    dataSelector: legacySentinel,
    defaultSize: { w: 24, h: 20 },
    minSize: { w: 12, h: 12 },
    configurableProperties: ["chartType"],
    component: LegacyChartEmbed as WidgetDefinition["component"],
  },
  {
    id: WORKBENCH_LEGACY_KPI_ID,
    name: "Legacy KPI",
    description: "Migrated KPI tile",
    category: "kpi",
    group: "Workbench legacy",
    dataSource: "workbench-legacy",
    dataSelector: legacySentinel,
    defaultSize: { w: 12, h: 10 },
    minSize: { w: 8, h: 8 },
    component: LegacyKpiEmbed as WidgetDefinition["component"],
  },
  {
    id: WORKBENCH_LEGACY_TABLE_ID,
    name: "Legacy table",
    description: "Migrated static table",
    category: "table",
    group: "Workbench legacy",
    dataSource: "workbench-legacy",
    dataSelector: legacySentinel,
    defaultSize: { w: 24, h: 22 },
    minSize: { w: 16, h: 12 },
    component: LegacyTableEmbed as WidgetDefinition["component"],
  },
  {
    id: WORKBENCH_LEGACY_PINNED_ID,
    name: "Legacy pinned insight",
    description: "Migrated pinned insight",
    category: "other",
    group: "Workbench legacy",
    dataSource: "workbench-legacy",
    dataSelector: legacySentinel,
    defaultSize: { w: 20, h: 18 },
    minSize: { w: 12, h: 12 },
    component: LegacyPinnedEmbed as WidgetDefinition["component"],
  },
];
