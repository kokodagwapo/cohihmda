/**
 * Core types for the Widget Architecture
 *
 * Widgets are atomic, self-describing UI components (a single KPI, chart, or table).
 * Each widget declares a data source; the WidgetDataProvider deduplicates fetches
 * so multiple widgets sharing a source produce only one API call.
 */

import type { ComponentType } from 'react';

// ---------------------------------------------------------------------------
// Data Sources – each maps 1:1 to an existing data hook
// ---------------------------------------------------------------------------

export type DataSourceId =
  | 'company-scorecard'
  | 'credit-risk'
  | 'sales-scorecard'
  | 'operations-scorecard'
  | 'operations-trends'
  | 'sales-trends'
  | 'funnel'
  | 'top-tiering-comparison'
  | 'dashboard-insights'
  | 'dashboard-metrics'
  | 'executive-dashboard'
  | 'closing-forecast'
  | 'financial-modeling'
  | 'aletheia-insights'
  | 'industry-news'
  | 'loan-detail'
  | 'workflow-conversion'
  | 'high-performers'
  | 'actors'
  | 'pricing-dashboard'
  | 'pipeline-analysis';

// ---------------------------------------------------------------------------
// Widget categories – drives catalog grouping & icon selection
// ---------------------------------------------------------------------------

export type WidgetCategory =
  | 'kpi'
  | 'chart'
  | 'table'
  | 'distribution'
  | 'funnel'
  | 'insight';

// ---------------------------------------------------------------------------
// Props every widget renderer receives
// ---------------------------------------------------------------------------

export interface WidgetRenderProps<TData = unknown> {
  /** The slice of source data for this widget (extracted via dataSelector) */
  data: TData | null;
  /** True while the data source is loading */
  loading: boolean;
  /** Error message if the data source failed */
  error: string | null;
  /** Current rendered width in pixels */
  width: number;
  /** Current rendered height in pixels */
  height: number;
  /** User-overridable settings (colors, number format, etc.) */
  config?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Widget Definition – the static "blueprint" for a widget type
// ---------------------------------------------------------------------------

export interface WidgetDefinition<TData = unknown> {
  /** Unique identifier, e.g. "company-scorecard-units" */
  id: string;
  /** Human-readable name, e.g. "Total Units" */
  name: string;
  /** Short description for the catalog tooltip */
  description: string;
  /** Visual category */
  category: WidgetCategory;
  /** Grouping label for the catalog, e.g. "Company Scorecard" */
  group: string;
  /** Which data source this widget needs */
  dataSource: DataSourceId;
  /** Extracts the specific slice of data this widget needs from the full source response */
  dataSelector: (sourceData: unknown) => TData;
  /** Default pixel size when dropped on the canvas */
  defaultSize: { w: number; h: number };
  /** Minimum pixel size for resize constraints */
  minSize?: { w: number; h: number };
  /** The React component that renders this widget */
  component: ComponentType<WidgetRenderProps<TData>>;
  /** Default config (colors, formatting, etc.) passed to the component */
  config?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Widget Instance – a placed widget on a canvas (references a definition)
// ---------------------------------------------------------------------------

export interface WidgetInstance {
  /** Unique instance ID on the canvas */
  id: string;
  /** Points to WidgetDefinition.id in the registry */
  definitionId: string;
  /** Pixel position on canvas */
  position: { x: number; y: number };
  /** Pixel size on canvas */
  size: { w: number; h: number };
  /** Instance-level config overrides (e.g. custom colors) */
  config?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// KPI-specific props (convenience type for KPICard)
// ---------------------------------------------------------------------------

export type KPIFormat = 'number' | 'currency' | 'percent' | 'days' | 'ratio';

export interface KPIData {
  value: number;
  label: string;
  format: KPIFormat;
  /** Optional previous-period value for trend calculation */
  previousValue?: number;
  /** Explicit trend override */
  trend?: 'up' | 'down' | 'flat';
  /** Explicit change string, e.g. "+12.3%" */
  change?: string;
  /** Subtitle or additional context */
  subtitle?: string;
}

// ---------------------------------------------------------------------------
// Chart-specific props (convenience type for ChartCard)
// ---------------------------------------------------------------------------

export type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'composed';

export interface ChartSeries {
  dataKey: string;
  name: string;
  color?: string;
  type?: 'bar' | 'line' | 'area';
}

export interface ChartData {
  title: string;
  chartType: ChartType;
  data: Record<string, unknown>[];
  series: ChartSeries[];
  xAxisKey: string;
  yAxisLabel?: string;
  stacked?: boolean;
  /** Optional: returns a fill color per data row (for per-bar coloring like tier colors) */
  colorAccessor?: (row: Record<string, unknown>, index: number) => string;
  /** Optional: data key for a cumulative percentage line (Pareto charts) */
  cumulativeKey?: string;
}

// ---------------------------------------------------------------------------
// Table-specific props (convenience type for DataTable)
// ---------------------------------------------------------------------------

export interface TableColumn {
  key: string;
  label: string;
  align?: 'left' | 'center' | 'right';
  format?: KPIFormat;
  sortable?: boolean;
  /** Highlight this column (e.g. tier columns with background tint) */
  highlight?: string;
  width?: string;
}

export interface TableData {
  title?: string;
  columns: TableColumn[];
  rows: Record<string, unknown>[];
  stickyFirstColumn?: boolean;
}

// ---------------------------------------------------------------------------
// TabbedTable-specific props (multiple tables in tabs within one container)
// ---------------------------------------------------------------------------

export interface TabbedTableData {
  /** Title shown above the tab bar */
  title?: string;
  /** Array of tab definitions – each tab holds a full TableData */
  tabs: {
    id: string;
    label: string;
    table: TableData;
  }[];
  /** Which tab to show by default (defaults to first) */
  defaultTab?: string;
}

// ---------------------------------------------------------------------------
// Distribution-specific props
// ---------------------------------------------------------------------------

export interface DistributionBar {
  label: string;
  value: number;
  total: number;
  color?: string;
}

export interface DistributionData {
  title: string;
  bars: DistributionBar[];
}
