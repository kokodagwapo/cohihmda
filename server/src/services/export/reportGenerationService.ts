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
// pptxgenjs is a CommonJS module. Under tsx (ESM mode) the CJS default export is
// sometimes double-wrapped as { default: Class }. Unwrap it at runtime so that
// `new PptxGenCtor()` always works regardless of the tsx interop shim.
// We keep the `pptxgen` name in scope for its type namespace (pptxgen.Slide, etc.).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PptxGenCtor: typeof pptxgen = ((pptxgen as any).default ?? pptxgen) as typeof pptxgen;
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
    if (Math.abs(num) >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`.replace("$$", "$");
    if (Math.abs(num) >= 1_000)
      return `$${Math.round(num / 1_000).toLocaleString()}K`.replace("$$", "$");
    return `$${num.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
  if (format === "percent") return `${num.toFixed(1)}%`;
  // Plain number
  if (Number.isInteger(num)) return num.toLocaleString();
  if (Math.abs(num) >= 100) return Math.round(num).toLocaleString();
  if (Math.abs(num) >= 10) return num.toFixed(1);
  return num.toFixed(2);
}

/**
 * PowerPoint's text pipeline can mangle some UI separator glyphs.
 * Normalize those to ASCII for native export while leaving canvas UI unchanged.
 */
function normalizePptText(value: unknown): string {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2013\u2014]/g, " - ")
    .replace(/[\u2192\u2794\u27A1]/g, " -> ")
    .replace(/\u00b7/g, " - ")
    .replace(/\u2022/g, "- ");
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
  const pres = new PptxGenCtor();

  // Presentation metadata
  pres.author = definition.author || "Coheus";
  pres.title = definition.title;
  pres.subject = definition.subtitle || "Mortgage Analytics Report";
  pres.company = "Coheus";

  pres.defineSlideMaster({
    title: "COHI_MASTER",
    background: { color: theme.backgroundColor.replace("#", "") },
    objects: [],
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
        slide.addText(normalizePptText(slideDef.title), {
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
        slide.addText(normalizePptText(slideDef.subtitle), {
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
        slide.addText(normalizePptText(slideDef.title), {
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
        slide.addText(normalizePptText(slideDef.title), {
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
        slide.addText(normalizePptText(slideDef.subtitle), {
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
const SLIDE_MAX_Y = 7.1;

function renderElement(
  slide: pptxgen.Slide,
  element: SlideElement,
  theme: ReportTheme
): void {
  const rawPos = element.position;
  const maxH = Math.max(0.5, SLIDE_MAX_Y - rawPos.y);
  const pos = { ...rawPos, h: Math.min(rawPos.h, maxH) };
  const { config } = element;
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
    case "insight":
    case "news":
      renderInsightElement(slide, pos, config, theme);
      break;
    case "rich_text":
      renderRichTextElement(slide, pos, config, theme);
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
    margin: 0,
    wrap: true,
  };

  slide.addText(normalizePptText(config.content || ""), textOpts);
}

function renderChartElement(
  slide: pptxgen.Slide,
  pos: { x: number; y: number; w: number; h: number },
  config: Record<string, any>,
  data: any,
  theme: ReportTheme
): void {
  const chartData = Array.isArray(data) ? data : config.data || [];
  const chartType = config.chartType || config.type || "bar";

  // treemap and pivot have no native pptxgenjs equivalent — fall back to table
  if (chartType === "treemap" || chartType === "pivot") {
    if (chartData.length) {
      const cols = Object.keys(chartData[0]);
      const autoColumns = cols.map((k) => ({ key: k, label: k }));
      renderTableElement(
        slide,
        pos,
        { type: "table", columns: autoColumns, data: chartData },
        chartData,
        theme
      );
    } else {
      slide.addText(`${config.title || chartType} (no data)`, {
        x: pos.x, y: pos.y, w: pos.w, h: pos.h,
        fontSize: 11, color: "999999", align: "center", valign: "middle",
        fontFace: theme.fontFamily,
      });
    }
    return;
  }

  if (!chartData.length) {
    slide.addText("No data available", {
      x: pos.x, y: pos.y, w: pos.w, h: pos.h,
      fontSize: 14, color: "999999", align: "center", valign: "middle",
      fontFace: theme.fontFamily,
    });
    return;
  }

  const xKey = config.xKey || Object.keys(chartData[0])[0];
  const yKey = config.yKey || Object.keys(chartData[0])[1];
  const yKeys = config.yKeys || (yKey ? [yKey] : []);
  const lineKey = config.lineKey;
  const colors = (config.colors || theme.chartColors).map((c: string) =>
    c.replace("#", "")
  );

  // Map chart type to pptxgenjs chart type
  let pptxChartType: any;
  switch (chartType) {
    case "bar":
    case "stacked_bar":
    case "grouped_bar":
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
    name: config.seriesNames?.[idx] || key,
    labels,
    values: chartData.map((d: Record<string, any>) =>
      typeof d[key] === "number" ? d[key] : parseFloat(d[key]) || 0
    ),
    color: colors[idx % colors.length],
  }));

  if (series.length === 0 && yKey) {
    series.push({
      name: config.seriesNames?.[0] || yKey,
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

    if (chartType === "combo" && lineKey) {
      const barSeries = series.slice(0, 2);
      const lineSeries = {
        name: config.seriesNames?.[barSeries.length] || lineKey,
        labels,
        values: chartData.map((d: Record<string, any>) =>
          typeof d[lineKey] === "number" ? d[lineKey] : parseFloat(d[lineKey]) || 0
        ),
        color: (config.lineColor || colors[barSeries.length] || theme.textColor).replace("#", ""),
      };

      slide.addChart([
        {
          type: pptxgen.charts ? pptxgen.charts.BAR : "bar",
          values: barSeries,
          options: {
            barGrouping: "clustered",
          },
        } as any,
        {
          type: pptxgen.charts ? pptxgen.charts.LINE : "line",
          values: [lineSeries],
          options: {
            secondaryValAxis: true,
          },
        } as any,
      ] as any, chartOpts);
      return;
    }

    if (chartType === "stacked_bar") {
      chartOpts.barGrouping = "stacked";
    } else if (chartType === "grouped_bar") {
      chartOpts.barGrouping = "clustered";
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
      x: pos.x, y: pos.y, w: pos.w, h: pos.h,
      fontSize: 12, color: "FF0000", align: "center", valign: "middle",
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
    Object.keys(tableData[0]).forEach((key) => {
      columns.push({ key, label: key });
    });
  }

  const fontSize = config.fontSize || 8;
  const headerFontSize = Math.min(fontSize + 1, 10);
  const ROW_H = 0.28;
  const HEADER_H = 0.32;
  const MAX_TOTAL_ROWS = TABLE_ROWS_PER_SLIDE * TABLE_MAX_PAGES;
  const cappedData = tableData.slice(0, MAX_TOTAL_ROWS);

  const headerRow: pptxgen.TableCell[] = columns.map((col) => ({
    text: normalizePptText(col.label || col.key),
    options: {
      bold: true,
      fontSize: headerFontSize,
      color: "FFFFFF",
      fill: { color: theme.primaryColor.replace("#", "") },
      fontFace: theme.fontFamily,
      align: (col.align as any) || "left",
      border: { type: "solid", pt: 0.5, color: "CCCCCC" },
      margin: [1, 3, 1, 3],
    },
  }));

  const dataRows: pptxgen.TableCell[][] = cappedData
    .map((row: Record<string, any>, rowIdx: number) =>
      columns.map((col) => {
        let val = row[col.key] ?? "";
        if (col.format === "currency" && typeof val === "number") {
          val = `$${val.toLocaleString()}`;
        } else if (col.format === "percent" && typeof val === "number") {
          val = `${val.toFixed(1)}%`;
        } else if (col.format === "ratio" && typeof val === "number") {
          val = val.toFixed(2);
        } else if (col.format === "days" && typeof val === "number") {
          val = `${Math.round(val)}d`;
        } else if (typeof val === "number") {
          val = val.toLocaleString();
        }
        return {
          text: normalizePptText(val),
          options: {
            fontSize: fontSize,
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
            margin: [1, 3, 1, 3],
          },
        } as pptxgen.TableCell;
      })
    );

  const allRows = [headerRow, ...dataRows];
  const rowH = [HEADER_H, ...dataRows.map(() => ROW_H)];

  const rawColW = columns.map((col) => {
    if (col.width) return col.width;
    const longestValue = cappedData.reduce((max, row) => {
      const len = String(row?.[col.key] ?? "").length;
      return Math.max(max, len);
    }, String(col.label || col.key).length);
    return Math.max(0.6, longestValue * 0.075);
  });
  const totalRawWidth = rawColW.reduce((sum, width) => sum + width, 0) || columns.length;
  const widthScale = pos.w / totalRawWidth;
  const colW = rawColW.map((width) => Number((width * widthScale).toFixed(3)));

  slide.addTable(allRows, {
    x: pos.x,
    y: pos.y,
    w: pos.w,
    colW,
    rowH,
    fontSize: fontSize,
    fontFace: theme.fontFamily,
    autoPage: true,
    autoPageRepeatHeader: true,
    autoPageHeaderRows: 1,
    newSlideStartY: 0.5,
    autoPageLineWeight: -0.3,
    margin: 0,
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
  const src = config.src || config.data;
  if (!src) return;

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

  // Accept both data URLs (base64) and remote paths
  if (src.startsWith("data:")) {
    imgOpts.data = src;
  } else if (src.startsWith("http://") || src.startsWith("https://")) {
    imgOpts.path = src;
  } else if (src.startsWith("/")) {
    // Relative path — skip silently (server can't resolve client-side paths)
    return;
  } else {
    imgOpts.data = src;
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
// Additional element renderers for canvas widget types
// ---------------------------------------------------------------------------

/** Strip HTML tags and convert common block elements to newlines */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderInsightElement(
  slide: pptxgen.Slide,
  pos: { x: number; y: number; w: number; h: number },
  config: Record<string, any>,
  theme: ReportTheme
): void {
  const ac = theme.accentColor.replace("#", "");
  const tc = theme.textColor.replace("#", "");

  // Accent left bar
  slide.addShape("rect" as any, {
    x: pos.x,
    y: pos.y,
    w: 0.06,
    h: pos.h,
    fill: { color: ac },
  });

  const textX = pos.x + 0.12;
  const textW = pos.w - 0.12;

  if (config.title) {
    slide.addText(config.title, {
      x: textX,
      y: pos.y,
      w: textW,
      h: 0.35,
      fontSize: 13,
      bold: true,
      color: tc,
      fontFace: theme.headerFontFamily,
    });
  }

  const bodyY = config.title ? pos.y + 0.38 : pos.y;
  const bodyH = config.title ? pos.h - 0.38 : pos.h;
  if (config.content || config.summary) {
    slide.addText(config.content || config.summary || "", {
      x: textX,
      y: bodyY,
      w: textW,
      h: bodyH,
      fontSize: 11,
      color: tc,
      fontFace: theme.fontFamily,
      wrap: true,
      valign: "top",
    });
  }

  if (config.link) {
    slide.addText(config.link, {
      x: textX,
      y: pos.y + pos.h - 0.2,
      w: textW,
      h: 0.2,
      fontSize: 9,
      color: ac,
      fontFace: theme.fontFamily,
      hyperlink: { url: config.link },
    });
  }
}

function renderRichTextElement(
  slide: pptxgen.Slide,
  pos: { x: number; y: number; w: number; h: number },
  config: Record<string, any>,
  theme: ReportTheme
): void {
  const plain = htmlToPlainText(config.html || config.content || "");
  slide.addText(plain || "", {
    x: pos.x,
    y: pos.y,
    w: pos.w,
    h: pos.h,
    fontSize: 11,
    color: theme.textColor.replace("#", ""),
    fontFace: theme.fontFamily,
    wrap: true,
    valign: "top",
  });
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
  lineKey?: string;
  colors: string[];
  lineColor?: string;
  title?: string;
  seriesNames?: string[];
  primaryAxisLabel?: string;
  secondaryAxisLabel?: string;
} {
  // Shape A – widget registry ChartData (has xAxisKey / series)
  if (widgetData?.xAxisKey || widgetData?.series) {
    return {
      chartType: widgetData.chartType || "bar",
      data: widgetData.data || [],
      xKey: widgetData.xAxisKey || "",
      yKey: widgetData.series?.[0]?.dataKey || "",
      yKeys: (widgetData.series || []).map((s: any) => s.dataKey),
      lineKey: widgetData.lineKey,
      colors: (widgetData.series || []).map((s: any) => s.color).filter(Boolean),
      lineColor: widgetData.lineColor,
      title: widgetData.title,
      seriesNames: (widgetData.series || []).map((s: any) => s.name || s.label || s.dataKey),
      primaryAxisLabel: widgetData.primaryAxisLabel,
      secondaryAxisLabel: widgetData.secondaryAxisLabel,
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
      lineKey: widgetData.lineKey,
      colors: widgetData.colors || [],
      lineColor: widgetData.lineColor,
      title: widgetData.title,
      seriesNames: widgetData.seriesNames,
      primaryAxisLabel: widgetData.primaryAxisLabel,
      secondaryAxisLabel: widgetData.secondaryAxisLabel,
    };
  }
  // Shape C – already normalised / AI-generated
  return {
    chartType: widgetData?.chartType || widgetData?.type || "bar",
    data: widgetData?.data || [],
    xKey: widgetData?.xKey || "",
    yKey: widgetData?.yKey || "",
    yKeys: widgetData?.yKeys || (widgetData?.yKey ? [widgetData.yKey] : []),
    lineKey: widgetData?.lineKey,
    colors: widgetData?.colors || [],
    lineColor: widgetData?.lineColor,
    title: widgetData?.title,
    seriesNames: widgetData?.seriesNames,
    primaryAxisLabel: widgetData?.primaryAxisLabel,
    secondaryAxisLabel: widgetData?.secondaryAxisLabel,
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
  /** Pixel-based canvas position — used for spatial slide ordering */
  layoutPosition?: { x: number; y: number; w: number; h: number };
  /** CanvasWidgetType discriminant */
  widgetType?: string;
}

// ---------------------------------------------------------------------------
// Spatial sort helpers
// ---------------------------------------------------------------------------

/** Sort widgets top-to-bottom, left-to-right by their canvas position */
function sortBySpatialPosition(widgets: CanvasWidgetForReport[]): CanvasWidgetForReport[] {
  return [...widgets].sort((a, b) => {
    const ay = a.layoutPosition?.y ?? 0;
    const by_ = b.layoutPosition?.y ?? 0;
    if (ay !== by_) return ay - by_;
    const ax = a.layoutPosition?.x ?? 0;
    const bx = b.layoutPosition?.x ?? 0;
    return ax - bx;
  });
}

/** Build a slide title from widget name + optional period label embedded in data. */
function getSlideTitle(w: CanvasWidgetForReport, fallback?: string): string {
  const d = w.data as any;
  const base = d?.title || fallback || w.widgetName;
  const period = d?._periodLabel;
  return period ? `${base} (${period})` : base;
}

// ---------------------------------------------------------------------------
// Determine the effective widget kind for slide routing
// ---------------------------------------------------------------------------

function resolveWidgetKind(
  w: CanvasWidgetForReport
): "kpi" | "chart" | "table" | "text" | "rich_text" | "image" | "insight" | "news" | "section_header" | "widget_group" | "embed" | "skip" {
  const wt = w.widgetType || (w.data as any)?.widgetType;
  // Primary routing by widgetType (the original CanvasWidgetType)
  switch (wt) {
    case "kpi": return "kpi";
    case "chart": return "chart";
    case "table": return "table";
    case "cohi_widget": {
      const vt = (w.data as any)?.vizType || (w.data as any)?.chartType;
      if (vt === "kpi") return "kpi";
      if (vt === "table") return "table";
      return "chart";
    }
    case "text_block": return "text";
    case "rich_text": return "rich_text";
    case "image": return "image";
    case "pinned_insight": return "insight";
    case "news_card": return "news";
    case "section_header": return "section_header";
    case "widget_group": return "widget_group";
    case "dashboard_section": return "embed";
    case "registry_widget": {
      // Fall through to category-based routing
      break;
    }
    default:
      break;
  }
  // Fall back to category
  switch (w.category) {
    case "kpi": return "kpi";
    case "chart": return "chart";
    case "table": return "table";
    case "embed": return "embed";
    default: return "text";
  }
}

// ---------------------------------------------------------------------------
// Slide builders per widget kind
// ---------------------------------------------------------------------------

function buildChartSlide(
  w: CanvasWidgetForReport,
  slideId: string,
  theme: ReportTheme
): SlideDefinition {
  const norm = normalizeChartWidgetData(w.data);
  return {
    id: slideId,
    layout: "chart-focus",
    title: getSlideTitle(w),
    elements: [
      {
        id: `el-${slideId}`,
        type: "chart",
        position: { x: 0.5, y: 1.1, w: 9, h: 4.8 },
        config: {
          type: "chart",
          chartType: norm.chartType,
          title: norm.title || getSlideTitle(w),
          data: norm.data,
          xKey: norm.xKey,
          yKey: norm.yKey,
          yKeys: norm.yKeys,
          lineKey: norm.lineKey,
          colors: norm.colors.length ? norm.colors : theme.chartColors,
          lineColor: norm.lineColor,
          seriesNames: norm.seriesNames,
          primaryAxisLabel: norm.primaryAxisLabel,
          secondaryAxisLabel: norm.secondaryAxisLabel,
          showLegend: true,
        },
        dataSource: { type: "static" as const, staticData: norm.data },
      },
    ],
  };
}

function isWorkflowConversionWidget(w: CanvasWidgetForReport): boolean {
  const data = w.data as any;
  return (
    data?.title === "Workflow Conversion" &&
    Array.isArray(data?.rows) &&
    Array.isArray(data?.charts)
  );
}

function buildWorkflowConversionSlides(
  w: CanvasWidgetForReport,
  theme: ReportTheme,
  slideIdBase: string
): SlideDefinition[] {
  const data = w.data as any;
  return (data.charts || []).flatMap((chartDef: any, idx: number) => {
    const norm = normalizeChartWidgetData(chartDef);
    if (!norm.data.length) return [];

    const row = data.rows?.[idx];
    const leftLabel = norm.seriesNames?.[0] || "From Count";
    const rightLabel = norm.seriesNames?.[1] || "To Count";
    const metricLabel =
      norm.seriesNames?.[2]
      || norm.secondaryAxisLabel
      || (norm.lineKey === "avgTurnTimeDays" ? "Avg Turn Time" : "Conversion %");
    const segmentTitle = chartDef.title || row?.segment || `Segment ${idx + 1}`;

    return [{
      id: `${slideIdBase}-${idx}`,
      layout: "content",
      title: `${getSlideTitle(w)} - ${segmentTitle}`,
      speakerNotes: `Workflow conversion segment: ${segmentTitle}. Review milestone volumes and the ${metricLabel.toLowerCase()} trend over time.`,
      elements: [
        {
          id: `${slideIdBase}-metrics-${idx}`,
          type: "metric-card",
          position: { x: 0.5, y: 1.0, w: 9, h: 1.0 },
          config: {
            type: "metric-card",
            columns: 3,
            metrics: [
              { label: leftLabel, value: row?.left ?? "--" },
              { label: metricLabel, value: row?.metric ?? "--" },
              { label: rightLabel, value: row?.right ?? "--" },
            ],
          },
          dataSource: { type: "static" as const, staticData: row },
        },
        {
          id: `${slideIdBase}-chart-${idx}`,
          type: "chart",
          position: { x: 0.5, y: 2.15, w: 9, h: 4.1 },
          config: {
            type: "chart",
            chartType: norm.chartType,
            title: segmentTitle,
            data: norm.data,
            xKey: norm.xKey,
            yKey: norm.yKey,
            yKeys: norm.yKeys,
            lineKey: norm.lineKey,
            colors: norm.colors.length ? norm.colors : theme.chartColors,
            lineColor: norm.lineColor,
            seriesNames: norm.seriesNames,
            primaryAxisLabel: norm.primaryAxisLabel,
            secondaryAxisLabel: norm.secondaryAxisLabel,
            showLegend: true,
          },
          dataSource: { type: "static" as const, staticData: norm.data },
        },
      ],
    }];
  });
}

const TABLE_ROWS_PER_SLIDE = 12;
const TABLE_MAX_PAGES = 5;

function buildTableSlide(
  w: CanvasWidgetForReport,
  slideId: string
): SlideDefinition {
  const norm = normalizeTableWidgetData(w.data);
  const maxRows = TABLE_ROWS_PER_SLIDE * TABLE_MAX_PAGES;
  const cappedData = norm.data.slice(0, maxRows);
  const totalRows = norm.data.length;
  const note = totalRows > maxRows
    ? `Showing ${maxRows} of ${totalRows} rows`
    : `${totalRows} rows`;

  return {
    id: slideId,
    layout: "table",
    title: getSlideTitle(w),
    subtitle: note,
    elements: [
      {
        id: `el-${slideId}`,
        type: "table",
        position: { x: 0.5, y: 1.15, w: 9, h: 5.2 },
        config: {
          type: "table",
          columns: norm.columns,
          data: cappedData,
          fontSize: 8,
        },
        dataSource: { type: "static" as const, staticData: cappedData },
      },
    ],
  };
}

function buildTextSlide(
  w: CanvasWidgetForReport,
  slideId: string,
  theme: ReportTheme
): SlideDefinition {
  const d = w.data as any;
  const content = d?.content || d?.html || (typeof d === "string" ? d : "");
  const isHtml = d?.widgetType === "rich_text" || (typeof content === "string" && /<[^>]+>/.test(content));
  return {
    id: slideId,
    layout: "content",
    title: getSlideTitle(w),
    elements: [
      {
        id: `el-${slideId}`,
        type: isHtml ? "rich_text" : "text",
        position: { x: 0.5, y: 1.0, w: 9, h: 5.0 },
        config: isHtml
          ? { type: "rich_text", html: content }
          : { type: "text", content, fontSize: 13, color: theme.textColor, lineSpacing: 1.5 },
        dataSource: { type: "static" as const, staticData: d },
      },
    ],
  };
}

function buildInsightSlide(
  w: CanvasWidgetForReport,
  slideId: string,
  theme: ReportTheme
): SlideDefinition {
  const d = w.data as any;
  return {
    id: slideId,
    layout: "content",
    title: d?.widgetType === "news_card" ? "News" : "Insight",
    elements: [
      {
        id: `el-${slideId}`,
        type: "insight",
        position: { x: 0.5, y: 1.0, w: 9, h: 5.0 },
        config: {
          type: "insight",
          title: d?.title || w.widgetName,
          content: d?.content || d?.summary || "",
          link: d?.link,
        },
        dataSource: { type: "static" as const, staticData: d },
      },
    ],
  };
}

function buildImageSlide(
  w: CanvasWidgetForReport,
  slideId: string
): SlideDefinition {
  const d = w.data as any;
  return {
    id: slideId,
    layout: "blank",
    title: getSlideTitle(w),
    elements: [
      {
        id: `el-${slideId}`,
        type: "image",
        position: { x: 0.5, y: 1.0, w: 9, h: 5.0 },
        config: {
          type: "image",
          src: d?.src || "",
          alt: d?.alt || getSlideTitle(w),
          objectFit: "contain",
        },
        dataSource: { type: "static" as const, staticData: d },
      },
    ],
  };
}

function buildSectionBreakSlide(
  title: string,
  slideId: string
): SlideDefinition {
  return { id: slideId, layout: "section-break", title, elements: [] };
}

/**
 * Convert canvas widget data into a multi-slide ReportDefinition.
 *
 * Ordering: widgets are sorted spatially (top-to-bottom, left-to-right).
 * KPIs that appear together near the top of the canvas are coalesced onto a
 * single "Key Metrics" slide. Each chart and table gets its own slide.
 * Text, insight, news, and image widgets each get their own content slide.
 * widget_group containers produce a section-break slide.
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
    subtitle: "Generated from Cohi Workbench",
    elements: [],
  });

  // Sort by spatial position so slide order matches canvas reading order
  const sorted = sortBySpatialPosition(widgets);

  let slideIndex = 0;

  for (const w of sorted) {
    const kind = resolveWidgetKind(w);

    if (kind === "skip") continue;

    if (kind === "section_header") {
      slides.push(buildSectionBreakSlide(getSlideTitle(w), `slide-section-${slideIndex++}`));
      continue;
    }

    if (kind === "widget_group") {
      slides.push(buildSectionBreakSlide(getSlideTitle(w), `slide-group-${slideIndex++}`));
      continue;
    }

    if (kind === "embed") {
      const d = w.data as any;
      const embedTitle = getSlideTitle(w);
      slides.push({
        id: `slide-embed-${slideIndex++}`,
        layout: "content",
        title: embedTitle,
        elements: [
          {
            id: `embed-text-${slideIndex}`,
            type: "text",
            position: { x: 0.5, y: 1.2, w: 9, h: 4.5 },
            config: {
              type: "text",
              content: `${embedTitle}\n\nThis section is a live dashboard embed. Open the Cohi Workbench canvas to view the full interactive data.`,
              fontSize: 13,
              color: theme.textColor,
              align: "center",
              verticalAlign: "middle",
            },
          },
        ],
      });
      continue;
    }

    if (kind === "kpi") {
      const d = w.data as any;
      if (!Array.isArray(d?.kpis) || d.kpis.length === 0) {
        continue;
      }
      const kpis = d.kpis as any[];
      const cols = Math.min(kpis.length, 4);
      const rows = Math.ceil(kpis.length / cols);
      const itemW = 8.5 / cols;
      const itemH = Math.min(1.6, 4.5 / rows);
      const elements: SlideElement[] = kpis.map((kpi: any, idx: number) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        return {
          id: `kpi-${slideIndex}-${idx}`,
          type: "kpi" as const,
          position: {
            x: 0.5 + col * itemW + 0.05,
            y: 1.0 + row * itemH + 0.05,
            w: itemW - 0.1,
            h: itemH - 0.1,
          },
          config: {
            type: "kpi",
            label: kpi.label ?? String(kpi.id ?? ""),
            value: kpi.value ?? "--",
            format: kpi.format || "text",
            change: kpi.change,
            trend: kpi.trend,
            color: theme.accentColor,
          },
          dataSource: { type: "static" as const, staticData: kpi },
        };
      });
      slides.push({
        id: `slide-kpi-${slideIndex++}`,
        layout: "kpi-grid",
        title: getSlideTitle(w),
        elements,
      });
      continue;
    }

    switch (kind) {
      case "chart":
        if (isWorkflowConversionWidget(w)) {
          const workflowSlides = buildWorkflowConversionSlides(w, theme, `slide-workflow-${slideIndex}`);
          workflowSlides.forEach((slide) => slides.push(slide));
          slideIndex += workflowSlides.length;
        } else {
          slides.push(buildChartSlide(w, `slide-chart-${slideIndex++}`, theme));
        }
        break;
      case "table":
        slides.push(buildTableSlide(w, `slide-table-${slideIndex++}`));
        break;
      case "text":
      case "rich_text":
        slides.push(buildTextSlide(w, `slide-text-${slideIndex++}`, theme));
        break;
      case "insight":
      case "news":
        slides.push(buildInsightSlide(w, `slide-insight-${slideIndex++}`, theme));
        break;
      case "image":
        slides.push(buildImageSlide(w, `slide-image-${slideIndex++}`));
        break;
    }
  }

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
