import type { ReactNode } from "react";
import {
  ChartTypeStrip,
  type ChartCardChartType,
} from "@/components/widgets/components/ChartTypeStrip";

export type { ChartCardChartType };
import { cn } from "@/lib/utils";

/** Reserved height for the chart-type strip at the bottom of chart widgets. */
export const CHART_TYPE_STRIP_H = 26;

export function normalizeChartCardType(raw: unknown): ChartCardChartType {
  if (raw === "line" || raw === "area" || raw === "pie" || raw === "bar") {
    return raw;
  }
  return "bar";
}

/** Body height when a type strip is shown below the chart. */
export function chartShellContentHeight(
  totalHeight: number,
  showTypeStrip: boolean,
): number {
  return showTypeStrip
    ? Math.max(80, totalHeight - CHART_TYPE_STRIP_H)
    : totalHeight;
}

export type ChartShellProps = {
  children: ReactNode;
  /** Registry path: standard bar/line/area/pie strip */
  chartType?: ChartCardChartType;
  onChartTypeChange?: (type: ChartCardChartType) => void;
  chartTypeStripDisabled?: boolean;
  showChartTypeStrip?: boolean;
  /** Cohi path: data-driven compatible types (overrides standard strip) */
  customTypeStrip?: ReactNode;
  footer?: ReactNode;
  className?: string;
  "data-testid"?: string;
};

/**
 * Shared flex column wrapper for chart-shaped widgets: body + optional type strip.
 */
export function ChartShell({
  children,
  chartType,
  onChartTypeChange,
  chartTypeStripDisabled = false,
  showChartTypeStrip = false,
  customTypeStrip,
  footer,
  className,
  "data-testid": dataTestId,
}: ChartShellProps) {
  const hasStandardStrip =
    showChartTypeStrip &&
    chartType != null &&
    onChartTypeChange != null &&
    !customTypeStrip;
  const hasStrip = !!customTypeStrip || hasStandardStrip;

  return (
    <div
      className={cn("h-full w-full flex flex-col min-h-0", className)}
      data-testid={dataTestId}
    >
      <div className="flex-1 min-h-0 min-w-0">{children}</div>
      {customTypeStrip}
      {hasStandardStrip && (
        <ChartTypeStrip
          value={chartType!}
          disabled={chartTypeStripDisabled}
          onChange={onChartTypeChange!}
        />
      )}
      {footer}
    </div>
  );
}
