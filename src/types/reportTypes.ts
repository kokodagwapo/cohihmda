/**
 * Report Builder Type Definitions
 *
 * Core data model for the Workbench Report Builder system.
 * Used by both frontend (Report Builder UI) and backend (PPTX/PDF generation).
 */

// ---------------------------------------------------------------------------
// Report Definition (top-level)
// ---------------------------------------------------------------------------

export interface ReportDefinition {
  id: string;
  title: string;
  subtitle?: string;
  author?: string;
  theme: ReportTheme;
  slides: SlideDefinition[];
  metadata: ReportMetadata;
}

export interface ReportMetadata {
  createdAt: string;
  updatedAt?: string;
  dataAsOf: string;
  tenant?: string;
  generatedBy?: 'user' | 'ai' | 'template';
  templateId?: string;
}

// ---------------------------------------------------------------------------
// Slide Definition
// ---------------------------------------------------------------------------

export type SlideLayout =
  | 'title'
  | 'content'
  | 'two-column'
  | 'chart-focus'
  | 'table'
  | 'kpi-grid'
  | 'section-break'
  | 'comparison'
  | 'blank';

export interface SlideDefinition {
  id: string;
  layout: SlideLayout;
  title?: string;
  subtitle?: string;
  elements: SlideElement[];
  speakerNotes?: string;
  /** Background override for this specific slide */
  background?: SlideBackground;
}

export interface SlideBackground {
  type: 'color' | 'gradient' | 'image';
  value: string;
  /** For gradient: secondary color */
  secondaryValue?: string;
}

// ---------------------------------------------------------------------------
// Slide Elements
// ---------------------------------------------------------------------------

export type SlideElementType =
  | 'text'
  | 'chart'
  | 'table'
  | 'kpi'
  | 'image'
  | 'metric-card'
  | 'shape';

export interface SlideElement {
  id: string;
  type: SlideElementType;
  /** Position in inches (for PPTX rendering). Origin is top-left of slide. */
  position: ElementPosition;
  config: SlideElementConfig;
}

export interface ElementPosition {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------
// Element Configs (discriminated union)
// ---------------------------------------------------------------------------

export type SlideElementConfig =
  | TextElementConfig
  | ChartElementConfig
  | TableElementConfig
  | KpiElementConfig
  | ImageElementConfig
  | MetricCardConfig
  | ShapeElementConfig;

export interface TextElementConfig {
  type: 'text';
  content: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  color?: string;
  align?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  bullet?: boolean;
  lineSpacing?: number;
}

export interface ChartElementConfig {
  type: 'chart';
  chartType: 'bar' | 'line' | 'pie' | 'area' | 'donut' | 'horizontal_bar' | 'stacked_bar' | 'grouped_bar' | 'treemap' | 'pivot' | 'combo';
  title?: string;
  data: ChartDataPoint[];
  xKey?: string;
  yKey?: string;
  yKeys?: string[];
  lineKey?: string;
  nameKey?: string;
  valueKey?: string;
  colors?: string[];
  lineColor?: string;
  seriesNames?: string[];
  primaryAxisLabel?: string;
  secondaryAxisLabel?: string;
  showLegend?: boolean;
  showGrid?: boolean;
  showValues?: boolean;
  stacked?: boolean;
}

export interface ChartDataPoint {
  [key: string]: string | number;
}

export interface TableElementConfig {
  type: 'table';
  columns: TableColumn[];
  data: Record<string, unknown>[];
  headerStyle?: TableCellStyle;
  cellStyle?: TableCellStyle;
  alternateRowColor?: string;
  showBorders?: boolean;
  fontSize?: number;
}

export interface TableColumn {
  key: string;
  label: string;
  width?: number;
  align?: 'left' | 'center' | 'right';
  format?: 'text' | 'number' | 'currency' | 'percent' | 'date';
}

export interface TableCellStyle {
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
}

export interface KpiElementConfig {
  type: 'kpi';
  label: string;
  value: number | string;
  format?: 'number' | 'currency' | 'percent';
  change?: number;
  changeLabel?: string;
  /** Trend direction: up is good, down is bad, neutral */
  trend?: 'up' | 'down' | 'neutral';
  icon?: string;
  color?: string;
  fontSize?: number;
  valueSize?: number;
}

export interface ImageElementConfig {
  type: 'image';
  /** Base64 data URL or remote URL */
  src: string;
  alt?: string;
  objectFit?: 'contain' | 'cover' | 'fill';
  borderRadius?: number;
}

export interface MetricCardConfig {
  type: 'metric-card';
  metrics: {
    label: string;
    value: number | string;
    format?: 'number' | 'currency' | 'percent';
    change?: number;
    trend?: 'up' | 'down' | 'neutral';
  }[];
  layout?: 'row' | 'grid';
  columns?: number;
}

export interface ShapeElementConfig {
  type: 'shape';
  shapeType: 'rect' | 'roundedRect' | 'circle' | 'line' | 'arrow';
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}


// ---------------------------------------------------------------------------
// Report Theme
// ---------------------------------------------------------------------------

export interface ReportTheme {
  name: string;
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  headerFontFamily: string;
  /** Chart color palette */
  chartColors: string[];
  /** Company logo (base64 data URL or URL) */
  logo?: string;
  /** Footer text (e.g., "Confidential - Company Name") */
  footerText?: string;
}

// ---------------------------------------------------------------------------
// Pre-built Themes
// ---------------------------------------------------------------------------

export const REPORT_THEMES: Record<string, ReportTheme> = {
  professional: {
    name: 'Coheus Professional',
    primaryColor: '#1e3a5f',
    accentColor: '#3b82f6',
    backgroundColor: '#ffffff',
    textColor: '#1e293b',
    fontFamily: 'Calibri',
    headerFontFamily: 'Calibri',
    chartColors: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'],
  },
  executiveBlue: {
    name: 'Executive Blue',
    primaryColor: '#0f172a',
    accentColor: '#2563eb',
    backgroundColor: '#f8fafc',
    textColor: '#0f172a',
    fontFamily: 'Calibri',
    headerFontFamily: 'Calibri',
    chartColors: ['#2563eb', '#1d4ed8', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#1e40af', '#1e3a8a'],
  },
  modernDark: {
    name: 'Modern Dark',
    primaryColor: '#f8fafc',
    accentColor: '#38bdf8',
    backgroundColor: '#0f172a',
    textColor: '#f8fafc',
    fontFamily: 'Calibri',
    headerFontFamily: 'Calibri',
    chartColors: ['#38bdf8', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#fb7185', '#22d3ee', '#a3e635'],
  },
  cleanLight: {
    name: 'Clean Light',
    primaryColor: '#111827',
    accentColor: '#059669',
    backgroundColor: '#ffffff',
    textColor: '#374151',
    fontFamily: 'Calibri',
    headerFontFamily: 'Calibri',
    chartColors: ['#059669', '#0891b2', '#7c3aed', '#dc2626', '#d97706', '#2563eb', '#db2777', '#65a30d'],
  },
};


// ---------------------------------------------------------------------------
// API Request/Response types
// ---------------------------------------------------------------------------

export interface GenerateReportRequest {
  definition: ReportDefinition;
  format: 'pptx' | 'pdf';
}

export interface GenerateReportFromCanvasRequest {
  canvasId?: string;
  widgetData: CanvasWidgetData[];
  format: 'pptx' | 'pdf';
  options?: {
    title?: string;
    theme?: ReportTheme;
    includeNotes?: boolean;
  };
}

export interface CanvasWidgetData {
  itemId: string;
  widgetName: string;
  category: 'kpi' | 'chart' | 'table' | 'embed' | 'other';
  data: unknown;
  type?: string;
  /** Pixel-based layout position on the canvas, used for slide ordering */
  layoutPosition?: { x: number; y: number; w: number; h: number };
  /** Original CanvasWidgetType discriminant (chart, kpi, table, cohi_widget, etc.) */
  widgetType?: string;
}

export interface AiGenerateReportRequest {
  prompt: string;
  format?: 'pptx' | 'pdf';
  context?: {
    canvasState?: unknown;
    widgetData?: CanvasWidgetData[];
  };
}

export interface AiGenerateReportResponse {
  definition: ReportDefinition;
  message: string;
}
