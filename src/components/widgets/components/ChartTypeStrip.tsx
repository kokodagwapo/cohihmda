/**
 * Compact chart-type switcher for registry ChartCard widgets (bar/line/area/pie).
 */
import {
  Activity,
  BarChart3,
  PieChart as PieChartIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ChartCardChartType = "bar" | "line" | "area" | "pie";

export const CHART_CARD_TYPE_OPTIONS: {
  type: ChartCardChartType;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}[] = [
  { type: "bar", label: "Bar", Icon: BarChart3 },
  { type: "line", label: "Line", Icon: Activity },
  { type: "area", label: "Area", Icon: BarChart3 },
  { type: "pie", label: "Pie", Icon: PieChartIcon },
];

export function ChartTypeStrip({
  value,
  onChange,
  disabled = false,
}: {
  value: ChartCardChartType;
  onChange: (type: ChartCardChartType) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-px px-1.5 py-1 border-t border-slate-200/50 dark:border-slate-700/50 bg-slate-50/80 dark:bg-slate-800/40 shrink-0 overflow-x-auto">
      <span className="text-[9px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider mr-0.5 shrink-0">
        Type:
      </span>
      {CHART_CARD_TYPE_OPTIONS.map(({ type, label, Icon }) => (
        <button
          key={type}
          type="button"
          disabled={disabled}
          className={cn(
            "h-5 px-1.5 rounded text-[9px] font-medium whitespace-nowrap canvas-interactive transition-colors flex items-center gap-0.5 shrink-0",
            value === type
              ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300"
              : "text-slate-400 dark:text-slate-500 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 hover:text-slate-600 dark:hover:text-slate-300",
            disabled && "opacity-50 cursor-not-allowed",
          )}
          onClick={() => onChange(type)}
          title={label}
        >
          <Icon className="w-2.5 h-2.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
