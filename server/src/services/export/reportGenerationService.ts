/**
 * Report Generation Service
 *
 * Backend engine for generating native PPTX and PDF reports from
 * ReportDefinition objects. Supports:
 * - Native PowerPoint charts, tables, text, KPIs, images
 * - Structured PDF with multi-page layout
 * - Data resolution from metrics service and SQL queries
 * - Slide master templates with branding
 */

import pptxgen from "pptxgenjs";
import pg from "pg";
import {
  queryMetric,
  queryMetrics,
  type MetricResult,
  type MetricQueryOptions,
} from "../metrics/metricsService.js";

// ---------------------------------------------------------------------------
// Types (mirror frontend reportTypes, but standalone for backend)
// ---------------------------------------------------------------------------

export interface ReportDefinition {
  id: string;
  title: string;
  subtitle?: string;
  author?: string;
  theme: ReportTheme;
  slides: SlideDefinition[];
  metadata: {
    createdAt: string;
    dataAsOf: string;
    tenant?: string;
    generatedBy?: "user" | "ai" | "template";
  };
}

export interface ReportTheme {
  name: string;
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  headerFontFamily: string;
  chartColors: string[];
  logo?: string;
  footerText?: string;
}

export type SlideLayout =
  | "title"
  | "content"
  | "two-column"
  | "chart-focus"
  | "table"
  | "kpi-grid"
  | "section-break"
  | "comparison"
  | "blank";

export interface SlideDefinition {
  id: string;
  layout: SlideLayout;
  title?: string;
  subtitle?: string;
  elements: SlideElement[];
  speakerNotes?: string;
  background?: { type: string; value: string; secondaryValue?: string };
}

export interface SlideElement {
  id: string;
  type: string;
  position: { x: number; y: number; w: number; h: number };
  config: Record<string, any>;
  dataSource?: DataSource;
  resolvedData?: unknown;
}

export interface DataSource {
  type: "metric" | "sql" | "static" | "canvas_widget";
  metricIds?: string[];
  sql?: string;
  options?: {
    dateRange?: { start: string; end: string };
    dateField?: string;
    groupBy?: string[];
    filters?: Record<string, unknown>;
    limit?: number;
  };
  staticData?: unknown;
  canvasWidgetId?: string;
}

// Default theme used when none specified
const DEFAULT_THEME: ReportTheme = {
  name: "Coheus Professional",
  primaryColor: "#1e3a5f",
  accentColor: "#3b82f6",
  backgroundColor: "#ffffff",
  textColor: "#1e293b",
  fontFamily: "Calibri",
  headerFontFamily: "Calibri",
  chartColors: [
    "#3b82f6",
    "#10b981",
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
    "#ec4899",
    "#06b6d4",
    "#84cc16",
  ],
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Smartly format a numeric value for display (KPIs, summaries, etc.) */
function formatDisplayValue(value: unknown, format?: string): string {
  if (value == null || value === "" || value === "--") return "--";
  const num = typeof value === "number" ? value : Number(value);
  if (isNaN(num)) return String(value);

  if (format === "currency") {
    if (Math.abs(num) >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
    if (Math.abs(num) >= 1_000)
      return `$${Math.round(num / 1_000).toLocaleString()}K`;
    return `$${num.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
  if (format === "percent") return `${num.toFixed(1)}%`;
  // Plain number
  if (Number.isInteger(num)) return num.toLocaleString();
  if (Math.abs(num) >= 100) return Math.round(num).toLocaleString();
  if (Math.abs(num) >= 10) return num.toFixed(1);
  return num.toFixed(2);
}

// ---------------------------------------------------------------------------
// Data Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve all data sources in a report definition.
 * Fetches metric data and executes SQL queries against the tenant database.
 */
export async function resolveReportData(
  definition: ReportDefinition,
  tenantPool: pg.Pool | null,
  userAccessFilter?: any
): Promise<ReportDefinition> {
  const resolved = structuredClone(definition);

  for (const slide of resolved.slides) {
    for (const element of slide.elements) {
      if (!element.dataSource) continue;

      try {
        element.resolvedData = await resolveDataSource(
          element.dataSource,
          tenantPool,
          userAccessFilter
        );
      } catch (err: any) {
        console.error(
          `[ReportGen] Failed to resolve data for element ${element.id}:`,
          err.message
        );
        element.resolvedData = null;
      }
    }
  }

  return resolved;
}

async function resolveDataSource(
  ds: DataSource,
  tenantPool: pg.Pool | null,
  userAccessFilter?: any
): Promise<unknown> {
  switch (ds.type) {
    case "static":
      return ds.staticData ?? null;

    case "canvas_widget":
      // Canvas widget data is passed directly from frontend
      return ds.staticData ?? null;

    case "metric": {
      if (!tenantPool || !ds.metricIds?.length) return null;
      const opts: MetricQueryOptions = {
        userAccessFilter: userAccessFilter ?? null,
      };
      if (ds.options?.dateRange) {
        opts.dateRange = {
          start: ds.options.dateRange.start ?? null,
          end: ds.options.dateRange.end ?? null,
        };
      }
      if (ds.options?.dateField) {
        opts.dateField = ds.options.dateField;
      }

      if (ds.metricIds.length === 1) {
        return await queryMetric(tenantPool, ds.metricIds[0], opts);
      }
      return await queryMetrics(tenantPool, ds.metricIds, opts);
    }

    case "sql": {
      if (!tenantPool || !ds.sql) return null;
      // Safety: only allow SELECT queries
      const trimmed = ds.sql.trim().toUpperCase();
      if (!trimmed.startsWith("SELECT")) {
        throw new Error("Only SELECT queries are allowed in report data sources");
      }
      const result = await tenantPool.query(ds.sql);
      return result.rows;
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// PPTX Generation
// ---------------------------------------------------------------------------

/**
 * Generate a PowerPoint file from a resolved ReportDefinition.
 * Returns a Buffer containing the .pptx file.
 */
export async function generatePptx(
  definition: ReportDefinition
): Promise<Buffer> {
  const theme = definition.theme || DEFAULT_THEME;
  const pres = new pptxgen();

  // Presentation metadata
  pres.author = definition.author || "Coheus";
  pres.title = definition.title;
  pres.subject = definition.subtitle || "Mortgage Analytics Report";
  pres.company = "Coheus";

  // Define slide master for consistent branding
  pres.defineSlideMaster({
    title: "COHI_MASTER",
    background: { color: theme.backgroundColor.replace("#", "") },
    objects: [
      // Footer bar
      {
        rect: {
          x: 0,
          y: "93%",
          w: "100%",
          h: "7%",
          fill: { color: theme.primaryColor.replace("#", "") },
        },
      },
      // Footer text
      {
        text: {
          text: theme.footerText || "Coheus - Confidential",
          options: {
            x: 0.5,
            y: "93.5%",
            w: 7,
            h: 0.35,
            fontSize: 8,
            color: "FFFFFF",
            fontFace: theme.fontFamily,
          },
        },
      },
      // Slide number
      {
        text: {
          text: "Slide ",
          options: {
            x: 8.5,
            y: "93.5%",
            w: 1,
            h: 0.35,
            fontSize: 8,
            color: "FFFFFF",
            fontFace: theme.fontFamily,
            align: "right",
          },
        },
      },
    ],
    slideNumber: {
      x: 9.2,
      y: "93.5%",
      fontSize: 8,
      color: "FFFFFF",
    },
  });

  // Generate each slide
  for (const slideDef of definition.slides) {
    const slide = pres.addSlide({ masterName: "COHI_MASTER" });

    // Slide background override
    if (slideDef.background) {
      if (slideDef.background.type === "color") {
        slide.background = {
          color: slideDef.background.value.replace("#", ""),
        };
      }
    }

    // Speaker notes
    if (slideDef.speakerNotes) {
      slide.addNotes(slideDef.speakerNotes);
    }

    // Layout-specific defaults
    renderSlideByLayout(slide, slideDef, theme);

    // Render each element
    for (const element of slideDef.elements) {
      renderElement(slide, element, theme);
    }
  }

  // Generate buffer
  const output = (await pres.write({ outputType: "nodebuffer" })) as Buffer;
  return Buffer.from(output);
}

/**
 * Apply layout-specific formatting (title bars, section breaks, etc.)
 */
function renderSlideByLayout(
  slide: pptxgen.Slide,
  slideDef: SlideDefinition,
  theme: ReportTheme
): void {
  const pc = theme.primaryColor.replace("#", "");
  const tc = theme.textColor.replace("#", "");
  const ac = theme.accentColor.replace("#", "");

  switch (slideDef.layout) {
    case "title":
      // Full-bleed title slide
      slide.background = { color: pc };
      if (slideDef.title) {
        slide.addText(slideDef.title, {
          x: 0.8,
          y: 1.5,
          w: 8.4,
          h: 1.5,
          fontSize: 36,
          bold: true,
          color: "FFFFFF",
          fontFace: theme.headerFontFamily,
        });
      }
      if (slideDef.subtitle) {
        slide.addText(slideDef.subtitle, {
          x: 0.8,
          y: 3.0,
          w: 8.4,
          h: 0.8,
          fontSize: 18,
          color: "CCCCCC",
          fontFace: theme.fontFamily,
        });
      }
      // Date line
      slide.addText(
        `Data as of ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
        {
          x: 0.8,
          y: 4.2,
          w: 8.4,
          h: 0.5,
          fontSize: 12,
          color: "999999",
          fontFace: theme.fontFamily,
        }
      );
      break;

    case "section-break":
      slide.background = { color: ac };
      if (slideDef.title) {
        slide.addText(slideDef.title, {
          x: 1,
          y: 2,
          w: 8,
          h: 1.5,
          fontSize: 32,
          bold: true,
          color: "FFFFFF",
          fontFace: theme.headerFontFamily,
          align: "center",
          valign: "middle",
        });
      }
      break;

    default:
      // Standard content slide: add title bar
      if (slideDef.title) {
        slide.addShape("rect" as any, {
          x: 0,
          y: 0,
          w: 10,
          h: 0.7,
          fill: { color: pc },
        });
        slide.addText(slideDef.title, {
          x: 0.5,
          y: 0.05,
          w: 9,
          h: 0.6,
          fontSize: 20,
          bold: true,
          color: "FFFFFF",
          fontFace: theme.headerFontFamily,
        });
      }
      if (slideDef.subtitle) {
        slide.addText(slideDef.subtitle, {
          x: 0.5,
          y: 0.75,
          w: 9,
          h: 0.35,
          fontSize: 11,
          color: tc,
          fontFace: theme.fontFamily,
          italic: true,
        });
      }
      break;
  }
}

/**
 * Render a single slide element (text, chart, table, kpi, image, etc.)
 */
function renderElement(
  slide: pptxgen.Slide,
  element: SlideElement,
  theme: ReportTheme
): void {
  const { position: pos, config } = element;
  const data = element.resolvedData ?? config.data ?? config.staticData;

  switch (config.type || element.type) {
    case "text":
      renderTextElement(slide, pos, config, theme);
      break;
    case "chart":
      renderChartElement(slide, pos, config, data, theme);
      break;
    case "table":
      renderTableElement(slide, pos, config, data, theme);
      break;
    case "kpi":
      renderKpiElement(slide, pos, config, data, theme);
      break;
    case "metric-card":
      renderMetricCardElement(slide, pos, config, data, theme);
      break;
    case "image":
      renderImageElement(slide, pos, config);
      break;
    case "shape":
      renderShapeElement(slide, pos, config, theme);
      break;
    default:
      // Fallback: render as text
      if (config.content || config.label) {
        slide.addText(config.content || config.label || "", {
          x: pos.x,
          y: pos.y,
          w: pos.w,
          h: pos.h,
          fontSize: 12,
          fontFace: theme.fontFamily,
          color: theme.textColor.replace("#", ""),
        });
      }
  }
}

// ---------------------------------------------------------------------------
// Element renderers
// ---------------------------------------------------------------------------

function renderTextElement(
  slide: pptxgen.Slide,
  pos: { x: number; y: number; w: number; h: number },
  config: Record<string, any>,
  theme: ReportTheme
): void {
  const textOpts: pptxgen.TextPropsOptions = {
    x: pos.x,
    y: pos.y,
    w: pos.w,
    h: pos.h,
    fontSize: config.fontSize || 12,
    fontFace: config.fontFamily || theme.fontFamily,
    color: (config.color || theme.textColor).replace("#", ""),
    bold: config.fontWeight === "bold",
    italic: config.fontStyle === "italic",
    align: config.align || "left",
    valign: config.verticalAlign || "top",
    bullet: config.bullet ? true : undefined,
    lineSpacingMultiple: config.lineSpacing || undefined,
    wrap: true,
  };

  slide.addText(config.content || "", textOpts);
}

function renderChartElement(
  slide: pptxgen.Slide,
  pos: { x: number; y: number; w: number; h: number },
  config: Record<string, any>,
  data: any,
  theme: ReportTheme
): void {
  const chartData = Array.isArray(data) ? data : config.data || [];
  if (!chartData.length) {
    // No data - render placeholder
    slide.addText("No data available", {
      x: pos.x,
      y: pos.y,
      w: pos.w,
      h: pos.h,
      fontSize: 14,
      color: "999999",
      align: "center",
      valign: "middle",
      fontFace: theme.fontFamily,
    });
    return;
  }

  const chartType = config.chartType || config.type || "bar";
  const xKey = config.xKey || Object.keys(chartData[0])[0];
  const yKey = config.yKey || Object.keys(chartData[0])[1];
  const yKeys = config.yKeys || (yKey ? [yKey] : []);
  const colors = (config.colors || theme.chartColors).map((c: string) =>
    c.replace("#", "")
  );

  // Map chart type to pptxgenjs chart type
  let pptxChartType: any;
  switch (chartType) {
    case "bar":
    case "stacked_bar":
      pptxChartType = pptxgen.charts ? pptxgen.charts.BAR : "bar";
      break;
    case "horizontal_bar":
      pptxChartType = pptxgen.charts ? pptxgen.charts.BAR : "bar";
      break;
    case "line":
      pptxChartType = pptxgen.charts ? pptxgen.charts.LINE : "line";
      break;
    case "area":
      pptxChartType = pptxgen.charts ? pptxgen.charts.AREA : "area";
      break;
    case "pie":
    case "donut":
      pptxChartType = pptxgen.charts ? pptxgen.charts.PIE : "pie";
      break;
    default:
      pptxChartType = pptxgen.charts ? pptxgen.charts.BAR : "bar";
  }

  // Build chart data in pptxgenjs format
  const labels = chartData.map(
    (d: Record<string, any>) => String(d[xKey] ?? "")
  );

  const series = yKeys.map((key: string, idx: number) => ({
    name: key,
    labels,
    values: chartData.map((d: Record<string, any>) =>
      typeof d[key] === "number" ? d[key] : parseFloat(d[key]) || 0
    ),
    color: colors[idx % colors.length],
  }));

  if (series.length === 0 && yKey) {
    series.push({
      name: yKey,
      labels,
      values: chartData.map((d: Record<string, any>) =>
        typeof d[yKey] === "number" ? d[yKey] : parseFloat(d[yKey]) || 0
      ),
      color: colors[0],
    });
  }

  try {
    const chartOpts: any = {
      x: pos.x,
      y: pos.y,
      w: pos.w,
      h: pos.h,
      showTitle: !!config.title,
      title: config.title || "",
      titleFontSize: 12,
      titleColor: theme.textColor.replace("#", ""),
      showLegend: config.showLegend !== false,
      legendPos: "b",
      legendFontSize: 9,
      showValue: config.showValues || false,
      catAxisLabelFontSize: 9,
      valAxisLabelFontSize: 9,
      chartColors: colors,
    };

    if (chartType === "stacked_bar") {
      chartOpts.barGrouping = "stacked";
    }
    if (chartType === "horizontal_bar") {
      chartOpts.barDir = "bar"; // horizontal
    }
    if (chartType === "donut") {
      chartOpts.holeSize = 50;
    }
    if (config.showGrid === false) {
      chartOpts.catGridLine = { style: "none" };
      chartOpts.valGridLine = { style: "none" };
    }

    slide.addChart(pptxChartType, series, chartOpts);
  } catch (err: any) {
    console.error(`[ReportGen] Chart render error:`, err.message);
    slide.addText(`Chart: ${config.title || "Error"}`, {
      x: pos.x,
      y: pos.y,
      w: pos.w,
      h: pos.h,
      fontSize: 12,
      color: "FF0000",
      align: "center",
      valign: "middle",
      fontFace: theme.fontFamily,
    });
  }
}

function renderTableElement(
  slide: pptxgen.Slide,
  pos: { x: number; y: number; w: number; h: number },
  config: Record<string, any>,
  data: any,
  theme: ReportTheme
): void {
  const tableData = Array.isArray(data) ? data : config.data || [];
  const columns: { key: string; label: string; width?: number; align?: string; format?: string }[] =
    config.columns || [];

  if (!columns.length && tableData.length) {
    // Auto-detect columns from data
    Object.keys(tableData[0]).forEach((key) => {
      columns.push({ key, label: key });
    });
  }

  // Build header row
  const headerRow: pptxgen.TableCell[] = columns.map((col) => ({
    text: col.label || col.key,
    options: {
      bold: true,
      fontSize: config.fontSize || 10,
      color: "FFFFFF",
      fill: { color: theme.primaryColor.replace("#", "") },
      fontFace: theme.fontFamily,
      align: (col.align as any) || "left",
      border: { type: "solid", pt: 0.5, color: "CCCCCC" },
      margin: [3, 5, 3, 5],
    },
  }));

  // Build data rows
  const dataRows: pptxgen.TableCell[][] = tableData
    .slice(0, 20) // Limit rows for slide readability
    .map((row: Record<string, any>, rowIdx: number) =>
      columns.map((col) => {
        let val = row[col.key] ?? "";
        // Format values
        if (col.format === "currency" && typeof val === "number") {
          val = `$${val.toLocaleString()}`;
        } else if (col.format === "percent" && typeof val === "number") {
          val = `${val.toFixed(1)}%`;
        } else if (typeof val === "number") {
          val = val.toLocaleString();
        }
        return {
          text: String(val),
          options: {
            fontSize: config.fontSize || 9,
            color: theme.textColor.replace("#", ""),
            fontFace: theme.fontFamily,
            align: (col.align as any) || "left",
            fill: {
              color:
                rowIdx % 2 === 1
                  ? (config.alternateRowColor || "#f8fafc").replace("#", "")
                  : "FFFFFF",
            },
            border: { type: "solid", pt: 0.5, color: "E2E8F0" },
            margin: [2, 5, 2, 5],
          },
        } as pptxgen.TableCell;
      })
    );

  const allRows = [headerRow, ...dataRows];

  // Calculate column widths
  const colW = columns.map(
    (col) => col.width || pos.w / columns.length
  );

  slide.addTable(allRows, {
    x: pos.x,
    y: pos.y,
    w: pos.w,
    colW,
    fontSize: config.fontSize || 9,
    fontFace: theme.fontFamily,
    autoPage: false,
  });
}

function renderKpiElement(
  slide: pptxgen.Slide,
  pos: { x: number; y: number; w: number; h: number },
  config: Record<string, any>,
  data: any,
  theme: ReportTheme
): void {
  const value = data?.value ?? config.value ?? "--";
  const label = config.label || "";

  // Format value with proper rounding
  let displayVal = String(value);
  const numVal = typeof value === "number" ? value : Number(value);
  const isNum = typeof value === "number" || (typeof value === "string" && !isNaN(numVal) && value.trim() !== "");

  if (config.format === "currency" && isNum) {
    if (Math.abs(numVal) >= 1_000_000) {
      displayVal = `$${(numVal / 1_000_000).toFixed(1)}M`;
    } else if (Math.abs(numVal) >= 1_000) {
      displayVal = `$${Math.round(numVal / 1_000).toLocaleString()}K`;
    } else {
      displayVal = `$${numVal.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    }
  } else if (config.format === "percent" && isNum) {
    displayVal = `${numVal.toFixed(1)}%`;
  } else if (isNum) {
    // Plain number: apply sensible rounding
    if (Number.isInteger(numVal)) {
      displayVal = numVal.toLocaleString();
    } else if (Math.abs(numVal) >= 100) {
      displayVal = Math.round(numVal).toLocaleString();
    } else if (Math.abs(numVal) >= 10) {
      displayVal = numVal.toFixed(1);
    } else {
      displayVal = numVal.toFixed(2);
    }
  }

  // KPI card background
  slide.addShape("rect" as any, {
    x: pos.x,
    y: pos.y,
    w: pos.w,
    h: pos.h,
    fill: { color: "F8FAFC" },
    line: { color: "E2E8F0", width: 1 },
    rectRadius: 0.1,
  });

  // KPI value
  slide.addText(displayVal, {
    x: pos.x,
    y: pos.y + 0.15,
    w: pos.w,
    h: pos.h * 0.5,
    fontSize: config.valueSize || 28,
    bold: true,
    color: (config.color || theme.accentColor).replace("#", ""),
    fontFace: theme.headerFontFamily,
    align: "center",
    valign: "middle",
  });

  // KPI label
  slide.addText(label, {
    x: pos.x,
    y: pos.y + pos.h * 0.55,
    w: pos.w,
    h: pos.h * 0.3,
    fontSize: config.fontSize || 11,
    color: theme.textColor.replace("#", ""),
    fontFace: theme.fontFamily,
    align: "center",
    valign: "top",
  });

  // Change indicator
  if (config.change != null) {
    const changeColor =
      config.change >= 0 ? "10B981" : "EF4444";
    const arrow = config.change >= 0 ? "\u25B2" : "\u25BC";
    slide.addText(`${arrow} ${Math.abs(config.change).toFixed(1)}%`, {
      x: pos.x,
      y: pos.y + pos.h * 0.78,
      w: pos.w,
      h: pos.h * 0.18,
      fontSize: 9,
      color: changeColor,
      fontFace: theme.fontFamily,
      align: "center",
      valign: "top",
    });
  }
}

function renderMetricCardElement(
  slide: pptxgen.Slide,
  pos: { x: number; y: number; w: number; h: number },
  config: Record<string, any>,
  data: any,
  theme: ReportTheme
): void {
  const metrics = config.metrics || [];
  const cols = config.columns || Math.min(metrics.length, 4);
  const itemW = pos.w / cols;
  const itemH = pos.h / Math.ceil(metrics.length / cols);

  metrics.forEach((metric: any, idx: number) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    renderKpiElement(
      slide,
      {
        x: pos.x + col * itemW + 0.05,
        y: pos.y + row * itemH + 0.05,
        w: itemW - 0.1,
        h: itemH - 0.1,
      },
      { ...metric, type: "kpi" },
      null,
      theme
    );
  });
}

function renderImageElement(
  slide: pptxgen.Slide,
  pos: { x: number; y: number; w: number; h: number },
  config: Record<string, any>
): void {
  if (!config.src) return;

  const imgOpts: any = {
    x: pos.x,
    y: pos.y,
    w: pos.w,
    h: pos.h,
    sizing: {
      type: config.objectFit === "cover" ? "cover" : "contain",
      w: pos.w,
      h: pos.h,
    },
  };

  if (config.src.startsWith("data:")) {
    imgOpts.data = config.src;
  } else {
    imgOpts.path = config.src;
  }

  try {
    slide.addImage(imgOpts);
  } catch (err: any) {
    console.error(`[ReportGen] Image render error:`, err.message);
  }
}

function renderShapeElement(
  slide: pptxgen.Slide,
  pos: { x: number; y: number; w: number; h: number },
  config: Record<string, any>,
  theme: ReportTheme
): void {
  const fill = config.fill
    ? { color: config.fill.replace("#", "") }
    : undefined;
  const line = config.stroke
    ? { color: config.stroke.replace("#", ""), width: config.strokeWidth || 1 }
    : undefined;

  switch (config.shapeType) {
    case "line":
    case "arrow":
      slide.addShape("line" as any, {
        x: pos.x,
        y: pos.y,
        w: pos.w,
        h: 0,
        line: line || { color: theme.textColor.replace("#", ""), width: 1 },
      });
      break;
    case "circle":
      slide.addShape("ellipse" as any, {
        x: pos.x,
        y: pos.y,
        w: pos.w,
        h: pos.h,
        fill,
        line,
      });
      break;
    case "roundedRect":
      slide.addShape("roundRect" as any, {
        x: pos.x,
        y: pos.y,
        w: pos.w,
        h: pos.h,
        fill,
        line,
        rectRadius: 0.15,
      });
      break;
    default:
      slide.addShape("rect" as any, {
        x: pos.x,
        y: pos.y,
        w: pos.w,
        h: pos.h,
        fill,
        line,
      });
  }
}

// ---------------------------------------------------------------------------
// PDF Generation (using basic text-based approach for now)
// Future: integrate chartjs-node-canvas for server-side chart rendering
// ---------------------------------------------------------------------------

/**
 * Generate a simple PDF report.
 * Returns a Buffer containing the .pdf file.
 *
 * NOTE: Full PDF generation with charts requires chartjs-node-canvas.
 * For Phase 1, we generate PPTX and convert client-side if PDF needed,
 * or use a simpler text-based PDF.
 */
export async function generatePdf(
  definition: ReportDefinition
): Promise<Buffer> {
  // For Phase 1, redirect to PPTX generation
  // PDF will be added in a future iteration with chartjs-node-canvas
  // For now, generate a simple text-based PDF using basic PDF structure
  const content = buildPdfTextContent(definition);
  return Buffer.from(content, "utf-8");
}

function buildPdfTextContent(definition: ReportDefinition): string {
  // Placeholder: return a structured text representation
  // Real PDF generation will use jsPDF or puppeteer in Phase 2
  const lines: string[] = [
    definition.title,
    definition.subtitle || "",
    `Generated: ${definition.metadata.createdAt}`,
    "---",
  ];

  for (const slide of definition.slides) {
    if (slide.title) lines.push(`\n## ${slide.title}`);
    if (slide.subtitle) lines.push(slide.subtitle);
    for (const el of slide.elements) {
      if (el.config.type === "text") {
        lines.push(el.config.content || "");
      } else if (el.config.type === "kpi") {
        lines.push(`${el.config.label}: ${el.config.value}`);
      }
    }
    lines.push("---");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Canvas-to-Report Conversion
// ---------------------------------------------------------------------------

/**
 * Normalise the various chart data shapes that canvas widgets report into a
 * single canonical shape understood by the PPTX chart renderer.
 *
 * Shape A  – ChartData from widget registry (WidgetGroup / WidgetRenderer):
 *   { chartType, xAxisKey, series: [{ dataKey, color }], data: [] }
 *
 * Shape B  – CohiWidgetRenderer custom shape:
 *   { vizType, data: [], xKey, yKey }
 *
 * Shape C  – Already-normalised or AI-generated:
 *   { chartType|type, data: [], xKey, yKey, yKeys, colors }
 */
function normalizeChartWidgetData(widgetData: any): {
  chartType: string;
  data: any[];
  xKey: string;
  yKey: string;
  yKeys: string[];
  colors: string[];
  title?: string;
} {
  // Shape A – widget registry ChartData (has xAxisKey / series)
  if (widgetData?.xAxisKey || widgetData?.series) {
    return {
      chartType: widgetData.chartType || "bar",
      data: widgetData.data || [],
      xKey: widgetData.xAxisKey || "",
      yKey: widgetData.series?.[0]?.dataKey || "",
      yKeys: (widgetData.series || []).map((s: any) => s.dataKey),
      colors: (widgetData.series || []).map((s: any) => s.color).filter(Boolean),
      title: widgetData.title,
    };
  }
  // Shape B – CohiWidgetRenderer { vizType, data, xKey, yKey }
  if (widgetData?.vizType || (widgetData?.xKey && !widgetData?.chartType)) {
    return {
      chartType: widgetData.vizType || "bar",
      data: widgetData.data || [],
      xKey: widgetData.xKey || "",
      yKey: widgetData.yKey || "",
      yKeys: widgetData.yKey ? [widgetData.yKey] : [],
      colors: widgetData.colors || [],
      title: widgetData.title,
    };
  }
  // Shape C – already normalised / AI-generated
  return {
    chartType: widgetData?.chartType || widgetData?.type || "bar",
    data: widgetData?.data || [],
    xKey: widgetData?.xKey || "",
    yKey: widgetData?.yKey || "",
    yKeys: widgetData?.yKeys || (widgetData?.yKey ? [widgetData.yKey] : []),
    colors: widgetData?.colors || [],
    title: widgetData?.title,
  };
}

/**
 * Normalise table widget data into the canonical { columns, data } shape.
 * Widget registry TableData uses `rows`; report elements expect `data`.
 */
function normalizeTableWidgetData(widgetData: any): {
  columns: { key: string; label: string; align?: string; format?: string }[];
  data: Record<string, any>[];
} {
  return {
    columns: widgetData?.columns || [],
    data: widgetData?.rows || widgetData?.data || [],
  };
}

export interface CanvasWidgetForReport {
  itemId: string;
  widgetName: string;
  category: "kpi" | "chart" | "table" | "embed" | "other";
  data: any;
  type?: string;
}

/**
 * Convert canvas widget data into a multi-slide ReportDefinition.
 * Groups widgets by type and creates logical slides.
 */
export function canvasToReportDefinition(
  widgets: CanvasWidgetForReport[],
  options?: { title?: string; theme?: ReportTheme }
): ReportDefinition {
  const theme = options?.theme || DEFAULT_THEME;
  const title = options?.title || "Canvas Report";
  const now = new Date().toISOString();

  const slides: SlideDefinition[] = [];

  // Slide 1: Title
  slides.push({
    id: "slide-title",
    layout: "title",
    title,
    subtitle: `Generated from Cohi Workbench`,
    elements: [],
  });

  // Group widgets by category
  const kpis = widgets.filter((w) => w.category === "kpi");
  const charts = widgets.filter((w) => w.category === "chart");
  const tables = widgets.filter((w) => w.category === "table");
  const others = widgets.filter(
    (w) => !["kpi", "chart", "table"].includes(w.category)
  );

  // Slide 2: KPIs (if any)
  if (kpis.length > 0) {
    const cols = Math.min(kpis.length, 4);
    const kpiElements: SlideElement[] = kpis
      .slice(0, 8)
      .map((kpi, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const itemW = 8.5 / cols;
        return {
          id: `kpi-${idx}`,
          type: "kpi" as const,
          position: {
            x: 0.5 + col * itemW + 0.05,
            y: 1.0 + row * 1.5 + 0.05,
            w: itemW - 0.1,
            h: 1.3,
          },
          config: {
            type: "kpi",
            label: kpi.widgetName,
            value: kpi.data?.value ?? kpi.data ?? "--",
            format: kpi.data?.format || "number",
            change: kpi.data?.change,
          },
          dataSource: {
            type: "static" as const,
            staticData: kpi.data,
          },
        };
      });

    slides.push({
      id: "slide-kpis",
      layout: "kpi-grid",
      title: "Key Metrics",
      elements: kpiElements,
    });
  }

  // Slides for charts (1 per slide)
  charts.forEach((chart, idx) => {
    const norm = normalizeChartWidgetData(chart.data);
    slides.push({
      id: `slide-chart-${idx}`,
      layout: "chart-focus",
      title: chart.widgetName,
      elements: [
        {
          id: `chart-${idx}`,
          type: "chart",
          position: { x: 0.5, y: 1.0, w: 9, h: 5.0 },
          config: {
            type: "chart",
            chartType: norm.chartType,
            title: chart.widgetName,
            data: norm.data,
            xKey: norm.xKey,
            yKey: norm.yKey,
            yKeys: norm.yKeys,
            colors: norm.colors.length ? norm.colors : undefined,
            showLegend: true,
          },
          dataSource: {
            type: "static" as const,
            staticData: norm.data,
          },
        },
      ],
    });
  });

  // Slides for tables (1 per slide)
  tables.forEach((table, idx) => {
    const norm = normalizeTableWidgetData(table.data);
    slides.push({
      id: `slide-table-${idx}`,
      layout: "table",
      title: table.widgetName,
      elements: [
        {
          id: `table-${idx}`,
          type: "table",
          position: { x: 0.5, y: 1.0, w: 9, h: 5.5 },
          config: {
            type: "table",
            columns: norm.columns,
            data: norm.data,
          },
          dataSource: {
            type: "static" as const,
            staticData: norm.data,
          },
        },
      ],
    });
  });

  // Any other widgets as text summary
  if (others.length > 0) {
    slides.push({
      id: "slide-other",
      layout: "content",
      title: "Additional Information",
      elements: others.map((w, idx) => ({
        id: `other-${idx}`,
        type: "text" as const,
        position: { x: 0.5, y: 1.0 + idx * 0.8, w: 9, h: 0.7 },
        config: {
          type: "text",
          content: `${w.widgetName}: ${typeof w.data === "string" ? w.data : JSON.stringify(w.data || "")}`,
          fontSize: 12,
        },
      })),
    });
  }

  // Executive Summary slide (auto-generated from KPI data)
  if (kpis.length > 0) {
    const summaryLines = kpis.map((kpi) => {
      const rawVal = kpi.data?.value ?? kpi.data ?? "--";
      const fmt = kpi.data?.format || "number";
      const val = formatDisplayValue(rawVal, fmt);
      const change = kpi.data?.change;
      const changeStr = change != null
        ? ` (${change >= 0 ? "+" : ""}${typeof change === "number" ? change.toFixed(1) : change}%)`
        : "";
      return `• ${kpi.widgetName}: ${val}${changeStr}`;
    }).join("\n");

    // Insert executive summary after title slide
    slides.splice(1, 0, {
      id: "slide-exec-summary",
      layout: "content",
      title: "Executive Summary",
      speakerNotes: "This slide provides a high-level overview of the key metrics from the canvas. Highlight the most important trends and any areas requiring attention.",
      elements: [
        {
          id: "exec-summary-text",
          type: "text",
          position: { x: 0.5, y: 1.0, w: 9, h: 5.0 },
          config: {
            type: "text",
            content: `Key Metrics Overview\n\n${summaryLines}\n\nReport generated from Cohi Workbench canvas on ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.`,
            fontSize: 13,
            color: theme.textColor,
            lineSpacing: 1.5,
          },
        },
      ],
    });
  }

  // Key Takeaways slide (final slide)
  const takeawayItems: string[] = [];
  // Find noteworthy KPIs (significant changes)
  for (const kpi of kpis) {
    const change = kpi.data?.change;
    if (change != null && typeof change === "number") {
      if (Math.abs(change) >= 5) {
        const direction = change >= 0 ? "increased" : "decreased";
        takeawayItems.push(`${kpi.widgetName} ${direction} by ${Math.abs(change).toFixed(1)}% — ${change >= 0 ? "positive trend to maintain" : "investigate root cause"}`);
      }
    }
  }
  if (takeawayItems.length === 0) {
    takeawayItems.push("Review the data presented in this report for actionable insights");
    takeawayItems.push("Compare these metrics against prior period targets");
    takeawayItems.push("Schedule follow-up discussion with stakeholders");
  }

  slides.push({
    id: "slide-takeaways",
    layout: "content",
    title: "Key Takeaways & Next Steps",
    speakerNotes: "Summarize the main findings and outline recommended action items. Tailor these points to your audience.",
    elements: [
      {
        id: "takeaways-text",
        type: "text",
        position: { x: 0.5, y: 1.0, w: 9, h: 5.0 },
        config: {
          type: "text",
          content: takeawayItems.map((item, i) => `${i + 1}. ${item}`).join("\n\n"),
          fontSize: 14,
          color: theme.textColor,
          lineSpacing: 1.8,
        },
      },
    ],
  });

  return {
    id: `report-${Date.now()}`,
    title,
    theme,
    slides,
    metadata: {
      createdAt: now,
      dataAsOf: now,
      generatedBy: "user",
    },
  };
}
