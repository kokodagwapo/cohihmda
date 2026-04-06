/**
 * ReportBuilder
 *
 * Full-screen overlay for building and editing multi-slide reports.
 * Features:
 * - Slide panel (left) for navigation and reordering
 * - Slide editor (center) with drag-and-drop elements
 * - Properties panel (right) for element configuration
 * - Theme customization
 * - Template gallery integration
 * - Export to PPTX/PDF via backend
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  Download,
  Presentation,
  Mail,
  Palette,
  LayoutTemplate,
  Save,
  Sparkles,
  Send,
  Loader2,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useCanvasDataStore } from '@/stores/canvasDataStore';

/** Authenticated POST returning a Blob (for binary PPTX/PDF downloads). */
async function fetchBlob(endpoint: string, body: object): Promise<Blob> {
  const res = await api.fetchWithAuth(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error');
    let errMsg = `Report generation failed (${res.status})`;
    try { errMsg = JSON.parse(errText).error || errMsg; } catch { /* use default */ }
    throw new Error(errMsg);
  }
  return res.blob();
}
import { SlidePanel } from './SlidePanel';
import { SlideEditor } from './SlideEditor';
import { SlideElementRenderer } from './SlideElementRenderer';
import { ReportTemplateGallery } from './ReportTemplateGallery';
import type {
  ReportDefinition,
  SlideDefinition,
  SlideElement,
  SlideElementType,
  SlideLayout,
  ReportTheme,
  SlideElementConfig,
  TextElementConfig,
  ChartElementConfig,
  TableElementConfig,
  KpiElementConfig,
  ImageElementConfig,
  ShapeElementConfig,
  ReportTemplate,
  CanvasWidgetData,
} from '@/types/reportTypes';
import { REPORT_THEMES } from '@/types/reportTypes';
import type { WidgetDataEntry } from '@/stores/canvasDataStore';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ReportBuilderProps {
  onClose: () => void;
  canvasWidgetData?: CanvasWidgetData[];
  canvasTitle?: string;
  tenantId?: string | null;
  /** Pre-loaded report definition (e.g., from AI generation) */
  initialDefinition?: ReportDefinition;
  /** When true, renders inline (fills parent) instead of as a fixed overlay */
  inline?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(prefix = 'el') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function createDefaultElement(type: SlideElementType): SlideElement {
  const id = generateId(type);
  const base = { id, type, position: { x: 1.0, y: 1.5, w: 4.0, h: 2.5 } };

  const configs: Record<string, SlideElementConfig> = {
    text: { type: 'text', content: 'Click to edit text', fontSize: 14, color: '#1e293b', align: 'left' } as TextElementConfig,
    chart: { type: 'chart', chartType: 'bar', title: 'Chart Title', data: [], xKey: 'label', yKey: 'value', showLegend: true } as ChartElementConfig,
    table: { type: 'table', columns: [{ key: 'col1', label: 'Column 1' }, { key: 'col2', label: 'Column 2' }], data: [] } as TableElementConfig,
    kpi: { type: 'kpi', label: 'Metric Name', value: 0, format: 'number' } as KpiElementConfig,
    image: { type: 'image', src: '', alt: 'Image' } as ImageElementConfig,
    'metric-card': { type: 'metric-card', metrics: [{ label: 'Metric 1', value: 0, format: 'number' }], columns: 3 },
    shape: { type: 'shape', shapeType: 'rect', fill: '#e2e8f0' } as ShapeElementConfig,
  };

  return { ...base, config: configs[type] || configs.text };
}

function createDefaultSlide(layout: SlideLayout = 'content'): SlideDefinition {
  return {
    id: generateId('slide'),
    layout,
    title: layout === 'title' ? 'Report Title' : '',
    subtitle: layout === 'title' ? 'Subtitle' : undefined,
    elements: [],
    speakerNotes: '',
  };
}

/** Smart number formatting for KPI display values. */
function fmtKpi(value: unknown, format?: string): string {
  if (value == null || value === '' || value === '--') return '--';
  const n = typeof value === 'number' ? value : Number(value);
  if (isNaN(n)) return String(value);
  if (format === 'currency') {
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    if (Math.abs(n) >= 1e3) return `$${Math.round(n / 1e3).toLocaleString()}K`;
    return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
  if (format === 'percent') return `${n.toFixed(1)}%`;
  if (Number.isInteger(n)) return n.toLocaleString();
  if (Math.abs(n) >= 100) return Math.round(n).toLocaleString();
  if (Math.abs(n) >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

/**
 * Normalise the various chart data shapes that widgets report into a single
 * canonical shape that the slide renderer / PPTX backend understands.
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
function normalizeChartData(widgetData: any): {
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
    const series = widgetData.series || [];
    return {
      chartType: widgetData.chartType || 'bar',
      data: widgetData.data || [],
      xKey: widgetData.xAxisKey || '',
      yKey: series[0]?.dataKey || '',
      yKeys: series.map((s: any) => s.dataKey),
      lineKey: widgetData.lineKey,
      colors: series.map((s: any) => s.color).filter(Boolean),
      lineColor: widgetData.lineColor,
      title: widgetData.title,
      seriesNames: series.map((s: any) => s.name || s.label || s.dataKey),
      primaryAxisLabel: widgetData.primaryAxisLabel,
      secondaryAxisLabel: widgetData.secondaryAxisLabel,
    };
  }
  // Shape B – CohiWidgetRenderer { vizType, data, xKey, yKey }
  if (widgetData?.vizType || (widgetData?.xKey && !widgetData?.chartType)) {
    return {
      chartType: widgetData.vizType || 'bar',
      data: widgetData.data || [],
      xKey: widgetData.xKey || '',
      yKey: widgetData.yKey || '',
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
    chartType: widgetData?.chartType || widgetData?.type || 'bar',
    data: widgetData?.data || [],
    xKey: widgetData?.xKey || '',
    yKey: widgetData?.yKey || '',
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
 * Handles: { columns, rows }, { columns, data }, { tabs: [{ table }] }, raw Array<object>.
 */
function normalizeTableData(widgetData: any): { columns: any[]; data: any[] } {
  if (widgetData == null) return { columns: [], data: [] };

  // Raw array of objects — infer columns from first row's keys
  if (Array.isArray(widgetData)) {
    if (widgetData.length === 0) return { columns: [], data: [] };
    const sample = widgetData[0];
    if (typeof sample !== 'object' || sample == null) return { columns: [], data: [] };
    const columns = Object.keys(sample).map((key) => ({
      key,
      label: key.replace(/([A-Z])/g, ' $1').replace(/^./, (s: string) => s.toUpperCase()).trim(),
      align: typeof sample[key] === 'number' ? 'right' as const : 'left' as const,
    }));
    return { columns, data: widgetData };
  }

  // Tabbed table — flatten all tabs into one table (use first tab with data)
  if (Array.isArray(widgetData.tabs)) {
    for (const tab of widgetData.tabs) {
      const t = tab?.table;
      if (t?.columns && t?.rows?.length > 0) {
        return { columns: t.columns, data: t.rows };
      }
    }
    return { columns: [], data: [] };
  }

  return {
    columns: widgetData.columns || [],
    data: widgetData.rows || widgetData.data || [],
  };
}

/**
 * Hydrate AI-generated slide elements that have empty/missing data by matching
 * them against live canvas widget data. This is a safety net: even when the AI
 * prompt tells Cohi to embed data, it sometimes produces elements with empty
 * config.value / config.data. This function fills in those blanks.
 */
function hydrateSlideData(
  slides: SlideDefinition[],
  canvasWidgets: WidgetDataEntry[]
): SlideDefinition[] {
  if (!canvasWidgets.length) return slides;

  // Build lookup indexes from canvas data
  const kpis = canvasWidgets.filter((w) => w.category === 'kpi');
  const charts = canvasWidgets.filter((w) => w.category === 'chart');
  const tables = canvasWidgets.filter(
    (w) => w.category === 'table' && !omitFromAutoCanvasSlides(w),
  );

  return slides.map((slide) => ({
    ...slide,
    elements: slide.elements.map((el) => {
      const cfg = el.config as any;
      if (!cfg) return el;

      // Hydrate KPI elements with missing value
      if (cfg.type === 'kpi') {
        const hasValue = cfg.value != null && cfg.value !== 0 && cfg.value !== '' && cfg.value !== '--';
        if (!hasValue && cfg.label) {
          // Try to find matching canvas KPI by label (fuzzy)
          const labelLower = (cfg.label || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          const match = kpis.find((k) => {
            const wName = k.widgetName.toLowerCase().replace(/[^a-z0-9]/g, '');
            return wName.includes(labelLower) || labelLower.includes(wName);
          });
          if (match) {
            const d = match.data as any;
            const value = d?.value ?? d;
            const format = d?.format || cfg.format;
            const change = d?.change;
            const trend = d?.trend;
            return {
              ...el,
              config: { ...cfg, value, format, ...(change != null ? { change } : {}), ...(trend ? { trend } : {}) },
            };
          }
        }
      }

      // Hydrate chart elements with missing data
      if (cfg.type === 'chart') {
        const hasData = Array.isArray(cfg.data) && cfg.data.length > 0;
        if (!hasData) {
          // Try to match by title
          const titleLower = (cfg.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          const match = charts.find((c) => {
            const wName = c.widgetName.toLowerCase().replace(/[^a-z0-9]/g, '');
            return wName.includes(titleLower) || titleLower.includes(wName);
          });
          if (match) {
            const norm = normalizeChartData(match.data);
            return {
              ...el,
              config: {
                ...cfg,
                data: norm.data,
                xKey: cfg.xKey || norm.xKey,
                yKey: cfg.yKey || norm.yKey,
                yKeys: cfg.yKeys?.length ? cfg.yKeys : norm.yKeys,
                colors: cfg.colors?.length ? cfg.colors : norm.colors,
                seriesNames: norm.seriesNames,
                chartType: cfg.chartType || norm.chartType,
              },
            };
          }
          if (charts.length > 0) {
            const norm = normalizeChartData(charts[0].data);
            if (norm.data.length > 0) {
              return {
                ...el,
                config: {
                  ...cfg,
                  data: norm.data,
                  xKey: cfg.xKey || norm.xKey,
                  yKey: cfg.yKey || norm.yKey,
                  yKeys: cfg.yKeys?.length ? cfg.yKeys : norm.yKeys,
                  colors: cfg.colors?.length ? cfg.colors : norm.colors,
                  seriesNames: norm.seriesNames,
                },
              };
            }
          }
        }
      }

      // Hydrate table elements with missing data
      if (cfg.type === 'table') {
        const hasData = Array.isArray(cfg.data) && cfg.data.length > 0;
        if (!hasData) {
          const titleLower = (cfg.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          const match = tables.find((t) => {
            const wName = t.widgetName.toLowerCase().replace(/[^a-z0-9]/g, '');
            return wName.includes(titleLower) || titleLower.includes(wName);
          });
          if (match) {
            const norm = normalizeTableData(match.data);
            return {
              ...el,
              config: {
                ...cfg,
                columns: cfg.columns?.length ? cfg.columns : norm.columns,
                data: norm.data,
              },
            };
          }
          if (tables.length > 0) {
            const norm = normalizeTableData(tables[0].data);
            if (norm.data.length > 0) {
              return {
                ...el,
                config: {
                  ...cfg,
                  columns: cfg.columns?.length ? cfg.columns : norm.columns,
                  data: norm.data,
                },
              };
            }
          }
        }
      }

      // If element has resolvedData (from backend), copy into config
      if (el.resolvedData != null) {
        if (cfg.type === 'kpi' && (cfg.value == null || cfg.value === 0)) {
          const rd = el.resolvedData as any;
          return { ...el, config: { ...cfg, value: rd?.value ?? rd } };
        }
        if (cfg.type === 'chart' && (!cfg.data || cfg.data.length === 0)) {
          return { ...el, config: { ...cfg, data: Array.isArray(el.resolvedData) ? el.resolvedData : [] } };
        }
        if (cfg.type === 'table' && (!cfg.data || cfg.data.length === 0)) {
          return { ...el, config: { ...cfg, data: Array.isArray(el.resolvedData) ? el.resolvedData : [] } };
        }
      }

      return el;
    }),
  }));
}

/**
 * Detect whether a widget's data is a sentinel placeholder ({ ready: true })
 * used by embed-style widgets that manage their own internal data fetching.
 * These can't be rendered as native chart/table elements.
 */
function isEmbedSentinel(data: unknown): boolean {
  if (data == null) return true;
  if (typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return Object.keys(d).length <= 1 && d.ready === true;
}

type CanvasWidgetLike = WidgetDataEntry & Pick<CanvasWidgetData, 'layoutPosition' | 'widgetType'>;

/** Loan-level grid is interactive and large — omit from auto-generated PowerPoint slides. */
function omitFromAutoCanvasSlides(w: WidgetDataEntry): boolean {
  return w.itemId.includes('estimated-closings-detail-table');
}

function sortBySpatialPosition(widgets: CanvasWidgetLike[]): CanvasWidgetLike[] {
  return [...widgets].sort((a, b) => {
    const ay = a.layoutPosition?.y ?? 0;
    const by = b.layoutPosition?.y ?? 0;
    if (ay !== by) return ay - by;
    const ax = a.layoutPosition?.x ?? 0;
    const bx = b.layoutPosition?.x ?? 0;
    return ax - bx;
  });
}

function stripHtml(html: string | undefined): string {
  return (html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Check if a widget has meaningful data that can be rendered in a slide.
 * Returns false for embed sentinels and empty/null data.
 */
function hasRenderableData(w: WidgetDataEntry): boolean {
  if (isEmbedSentinel(w.data)) return false;
  const d = w.data as any;
  if (d == null) return false;
  if (w.category === 'chart') {
    if (Array.isArray(d?.charts) && d.charts.some((chart: any) => Array.isArray(chart?.data) && chart.data.length > 0)) return true;
    if (d?.data && Array.isArray(d.data) && d.data.length > 0) return true;
    if (d?.xKey && d?.data) return true;
    if (d?.columns && d?.rows) return true;
    return false;
  }
  if (w.category === 'kpi') {
    if (d?.value != null || d?.label != null) return true;
    if (Array.isArray(d?.kpis) && d.kpis.length > 0) return true;
    return false;
  }
  if (w.category === 'table') {
    if (Array.isArray(d)) return d.length > 0;
    if (d?.rows?.length > 0 || d?.data?.length > 0) return true;
    // Tabbed table: { tabs: [{ table: { rows } }] }
    if (Array.isArray(d?.tabs) && d.tabs.some((t: any) => t?.table?.rows?.length > 0)) return true;
    // Nested columns+rows
    if (d?.columns && d?.rows) return true;
    return false;
  }
  if (w.category === 'other') {
    if (typeof d?.content === 'string' && d.content.trim().length > 0) return true;
    if (typeof d?.summary === 'string' && d.summary.trim().length > 0) return true;
    if (typeof d?.html === 'string' && stripHtml(d.html).length > 0) return true;
    if (typeof d?.title === 'string' && d.title.trim().length > 0) return true;
    return false;
  }
  return d != null;
}

function isWorkflowConversionPayload(data: any): boolean {
  return (
    data?.title === 'Workflow Conversion' &&
    Array.isArray(data?.rows) &&
    Array.isArray(data?.charts)
  );
}

/**
 * Convert canvas widget data into report slides (client-side).
 * Produces a structured set of slides: Title -> Executive Summary -> KPIs -> Charts -> Tables -> Embeds -> Takeaways.
 */
function canvasWidgetsToSlides(
  widgets: CanvasWidgetLike[],
  canvasTitle?: string
): SlideDefinition[] {
  const slides: SlideDefinition[] = [];

  if (process.env.NODE_ENV === 'development') {
    console.log('[ReportBuilder] canvasWidgetsToSlides input:', widgets.map((w) => ({
      name: w.widgetName,
      category: w.category,
      hasData: hasRenderableData(w),
      periodLabel: (w.data as any)?._periodLabel,
      dataSample: typeof w.data === 'object' ? Object.keys(w.data as any).slice(0, 5) : typeof w.data,
    })));
  }

  // Title slide
  slides.push({
    id: generateId('slide'),
    layout: 'title',
    title: canvasTitle || 'Canvas Report',
    subtitle: `Generated from Cohi Workbench — ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    elements: [],
    speakerNotes: 'Title slide for the report generated from the current canvas.',
  });

  // Keep slide order aligned with canvas reading order.
  const withData = sortBySpatialPosition(
    widgets.filter((w) => hasRenderableData(w) && !omitFromAutoCanvasSlides(w)) as CanvasWidgetLike[],
  );
  const kpis = withData.filter((w) => w.category === 'kpi');

  const getWidgetTitle = (widget: CanvasWidgetLike, fallback?: string) => {
    const d = widget.data as any;
    const base = d?.title || fallback || widget.widgetName;
    const period = d?._periodLabel;
    return period ? `${base} (${period})` : base;
  };

  const getWidgetSummary = (widget: CanvasWidgetLike): string | undefined => {
    const d = widget.data as any;
    const summary = d?.summary || d?.summaryLine;
    return typeof summary === 'string' && summary.trim().length > 0 ? summary.trim() : undefined;
  };


  const TABLE_ROWS_PER_SLIDE = 12;
  const TABLE_MAX_PAGES = 5;

  const pushTableSlide = (
    title: string,
    norm: { columns: any[]; data: any[] },
    summary: string | undefined,
    speakerNotes: string,
  ) => {
    const totalRows = norm.data.length;
    const maxRows = TABLE_ROWS_PER_SLIDE * TABLE_MAX_PAGES;
    const cappedData = norm.data.slice(0, maxRows);
    const totalPages = Math.max(1, Math.min(TABLE_MAX_PAGES, Math.ceil(cappedData.length / TABLE_ROWS_PER_SLIDE)));

    for (let page = 0; page < totalPages; page++) {
      const start = page * TABLE_ROWS_PER_SLIDE;
      const end = Math.min(start + TABLE_ROWS_PER_SLIDE, cappedData.length);
      const pageData = cappedData.slice(start, end);
      const rangeLabel = `Rows ${start + 1}-${end} of ${totalRows}`;
      const titleSuffix = totalPages > 1 ? ` (${page + 1}/${totalPages})` : '';
      const truncationNote = totalRows > maxRows && page === totalPages - 1
        ? `${rangeLabel} (showing first ${maxRows})`
        : rangeLabel;

      const hasSummary = !!summary && page === 0;
      slides.push({
        id: generateId('slide'),
        layout: 'table',
        title: `${title}${titleSuffix}`,
        speakerNotes,
        elements: [
          ...(hasSummary
            ? [{
                id: generateId('text'),
                type: 'text' as const,
                position: { x: 0.5, y: 1.0, w: 9, h: 0.4 },
                config: {
                  type: 'text',
                  content: summary!,
                  fontSize: 10,
                  color: '#475569',
                  lineSpacing: 1.2,
                } as TextElementConfig,
              }]
            : []),
          {
            id: generateId('text'),
            type: 'text' as const,
            position: { x: 0.5, y: hasSummary ? 1.4 : 0.78, w: 9, h: 0.22 },
            config: {
              type: 'text',
              content: truncationNote,
              fontSize: 8,
              color: '#94a3b8',
              align: 'right',
            } as TextElementConfig,
          },
          {
            id: generateId('table'),
            type: 'table',
            position: { x: 0.5, y: hasSummary ? 1.65 : 1.05, w: 9, h: hasSummary ? 4.7 : 5.2 },
            config: {
              type: 'table',
              columns: norm.columns,
              data: pageData,
              fontSize: 8,
            } as TableElementConfig,
          },
        ],
      });
    }
  };

  const pushChartSlide = (
    title: string,
    norm: ReturnType<typeof normalizeChartData>,
    summary: string | undefined,
    speakerNotes: string,
  ) => {
    const hasSummary = !!summary;
    slides.push({
      id: generateId('slide'),
      layout: 'chart-focus',
      title,
      speakerNotes,
      elements: [
        ...(hasSummary
          ? [{
              id: generateId('text'),
              type: 'text' as const,
              position: { x: 0.5, y: 1.0, w: 9, h: 0.4 },
              config: {
                type: 'text',
                content: summary!,
                fontSize: 10,
                color: '#475569',
                lineSpacing: 1.2,
              } as TextElementConfig,
            }]
          : []),
        {
          id: generateId('chart'),
          type: 'chart',
          position: { x: 0.5, y: hasSummary ? 1.45 : 1.0, w: 9, h: hasSummary ? 4.55 : 5.0 },
          config: {
            type: 'chart',
            chartType: norm.chartType,
            title,
            data: norm.data,
            xKey: norm.xKey,
            yKey: norm.yKey,
            yKeys: norm.yKeys,
            lineKey: norm.lineKey,
            colors: norm.colors.length ? norm.colors : undefined,
            lineColor: norm.lineColor,
            seriesNames: norm.seriesNames,
            primaryAxisLabel: norm.primaryAxisLabel,
            secondaryAxisLabel: norm.secondaryAxisLabel,
            showLegend: true,
            showValues: true,
          } as ChartElementConfig,
        },
      ],
    });
  };

  const pushWorkflowConversionSlides = (widget: CanvasWidgetLike, payload: any) => {
    payload.charts.forEach((chartDef: any, idx: number) => {
      const norm = normalizeChartData(chartDef);
      if (norm.data.length === 0) return;

      const row = payload.rows?.[idx];
      const leftLabel = norm.seriesNames?.[0] || 'From Count';
      const rightLabel = norm.seriesNames?.[1] || 'To Count';
      const metricLabel =
        norm.seriesNames?.[2]
        || norm.secondaryAxisLabel
        || (norm.lineKey === 'avgTurnTimeDays' ? 'Avg Turn Time' : 'Conversion %');
      const segmentTitle = chartDef.title || row?.segment || `Segment ${idx + 1}`;

      slides.push({
        id: generateId('slide'),
        layout: 'content',
        title: `${getWidgetTitle(widget)} - ${segmentTitle}`,
        speakerNotes: `Workflow conversion segment: ${segmentTitle}. Review the milestone volumes and the ${metricLabel.toLowerCase()} trend over time.`,
        elements: [
          {
            id: generateId('metric-card'),
            type: 'metric-card',
            position: { x: 0.5, y: 1.0, w: 9, h: 1.0 },
            config: {
              type: 'metric-card',
              columns: 3,
              metrics: [
                { label: leftLabel, value: row?.left ?? '--' },
                { label: metricLabel, value: row?.metric ?? '--' },
                { label: rightLabel, value: row?.right ?? '--' },
              ],
            } as MetricCardConfig,
          },
          {
            id: generateId('chart'),
            type: 'chart',
            position: { x: 0.5, y: 2.15, w: 9, h: 4.1 },
            config: {
              type: 'chart',
              chartType: norm.chartType as ChartElementConfig['chartType'],
              title: segmentTitle,
              data: norm.data,
              xKey: norm.xKey,
              yKey: norm.yKey,
              yKeys: norm.yKeys,
              lineKey: norm.lineKey,
              colors: norm.colors.length ? norm.colors : undefined,
              lineColor: norm.lineColor,
              seriesNames: norm.seriesNames,
              primaryAxisLabel: norm.primaryAxisLabel,
              secondaryAxisLabel: norm.secondaryAxisLabel,
              showLegend: true,
            } as ChartElementConfig,
          },
        ],
      });
    });
  };

  // KPIs are rendered inline as grid slides — no separate executive summary

  for (const widget of withData) {
    const d = widget.data as any;

    if (widget.category === 'kpi') {
      if (!Array.isArray(d?.kpis) || d.kpis.length === 0) {
        continue;
      }
      const title = getWidgetTitle(widget);
      const entries = d.kpis.map((k: any) => ({
        label: k.label ?? String(k.id ?? ''),
        value: String(k.value ?? '--'),
        change: k.change,
        trend: k.trend,
      }));
      const cols = Math.min(entries.length, 4);
      const rows = Math.ceil(entries.length / cols);
      const itemW = 8.5 / cols;
      const maxH = Math.min(1.3, 5.0 / rows);
      const rowSpacing = maxH + 0.1;
      const elements: SlideElement[] = entries.map((kpi: any, idx: number) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        return {
          id: generateId('kpi'),
          type: 'metric-card' as const,
          position: { x: 0.5 + col * itemW + 0.05, y: 1.0 + row * rowSpacing + 0.05, w: itemW - 0.1, h: maxH },
          config: {
            type: 'metric-card',
            metrics: [{ label: kpi.label, value: kpi.value, format: 'text', change: kpi.change, trend: kpi.trend }],
          },
        };
      });
      slides.push({
        id: generateId('slide'),
        layout: 'kpi-grid',
        title,
        speakerNotes: `${title}: KPI overview from the canvas.`,
        elements,
      });
      continue;
    }

    if (widget.category === 'chart') {
      if (isWorkflowConversionPayload(d)) {
        pushWorkflowConversionSlides(widget, d);
        continue;
      }
      if (Array.isArray(d?.charts) && d.charts.length > 0) {
        d.charts.forEach((chartDef: any, idx: number) => {
          const norm = normalizeChartData(chartDef);
          if (norm.data.length === 0) return;
          pushChartSlide(
            d.charts.length > 1 ? `${getWidgetTitle(widget)} - ${chartDef.title || `Chart ${idx + 1}`}` : (chartDef.title || getWidgetTitle(widget)),
            norm,
            chartDef.summary,
            `Chart: ${chartDef.title || widget.widgetName}. Discuss the trends and notable data points visible in this visualization.`,
          );
        });
        if (Array.isArray(d?.rows) && d.rows.length > 0) {
          pushTableSlide(
            `${getWidgetTitle(widget)} Summary`,
            normalizeTableData(d),
            getWidgetSummary(widget),
            `Data table: ${widget.widgetName}. Review the detailed data and highlight key rows.`,
          );
        }
        continue;
      }
      if (d?.columns && d?.rows) {
        pushTableSlide(
          getWidgetTitle(widget),
          normalizeTableData(d),
          getWidgetSummary(widget),
          `Data table: ${widget.widgetName}. Review the detailed data and highlight key rows.`,
        );
        continue;
      }
      const norm = normalizeChartData(d);
      if (norm.data.length > 0) {
        pushChartSlide(
          getWidgetTitle(widget),
          norm,
          getWidgetSummary(widget),
          `Chart: ${widget.widgetName}. Discuss the trends and notable data points visible in this visualization.`,
        );
      }
      continue;
    }

    if (widget.category === 'table') {
      if (Array.isArray(d?.leaders) && d.leaders.length > 0) {
        const hasSummary = !!getWidgetSummary(widget);
        const kpiY = hasSummary ? 1.4 : 1.05;
        const KPI_H = 1.0;
        const tableY = kpiY + KPI_H + 0.15;
        const tableH = 6.4 - tableY;
        const norm = normalizeTableData(d);
        const maxVisibleRows = Math.floor((tableH - 0.3) / 0.25);
        const cappedData = norm.data.slice(0, Math.max(maxVisibleRows, 5));

        slides.push({
          id: generateId('slide'),
          layout: 'content',
          title: getWidgetTitle(widget),
          speakerNotes: `${widget.widgetName}: leaderboard summary from the canvas.`,
          elements: [
            ...(hasSummary
              ? [{
                  id: generateId('text'),
                  type: 'text' as const,
                  position: { x: 0.5, y: 1.0, w: 9, h: 0.35 },
                  config: {
                    type: 'text',
                    content: getWidgetSummary(widget)!,
                    fontSize: 9,
                    color: '#475569',
                    lineSpacing: 1.2,
                  } as TextElementConfig,
                }]
              : []),
            {
              id: generateId('metric-card'),
              type: 'metric-card',
              position: { x: 0.5, y: kpiY, w: 9, h: KPI_H },
              config: {
                type: 'metric-card',
                columns: Math.min(d.leaders.length, 5),
                metrics: d.leaders.map((leader: { name: string; units: string; volume: string; cycleTime: string; pullThru: string; revenue: string }) => ({
                  label: leader.name,
                  value:
                    d.rankingMetric === 'volume'
                      ? leader.volume
                      : d.rankingMetric === 'turnTime'
                        ? leader.cycleTime
                        : d.rankingMetric === 'pullThrough'
                          ? leader.pullThru
                          : d.rankingMetric === 'revenue'
                            ? leader.revenue
                            : `${leader.units} units`,
                  format: 'text',
                })),
              },
            } as SlideElement,
            {
              id: generateId('table'),
              type: 'table',
              position: { x: 0.5, y: tableY, w: 9, h: tableH },
              config: {
                type: 'table',
                columns: norm.columns,
                data: cappedData,
                fontSize: 8,
              } as TableElementConfig,
            },
          ],
        });

        if (norm.data.length > cappedData.length) {
          pushTableSlide(
            `${getWidgetTitle(widget)} (cont.)`,
            { columns: norm.columns, data: norm.data.slice(cappedData.length) },
            undefined,
            `Continuation of ${widget.widgetName} data table.`,
          );
        }
        continue;
      }
      pushTableSlide(
        getWidgetTitle(widget),
        normalizeTableData(d),
        getWidgetSummary(widget),
        `Data table: ${widget.widgetName}. Review the detailed data and highlight key rows.`,
      );
      continue;
    }

    if (Array.isArray(d) || d?.rows || d?.columns || d?.tabs) {
      const norm = normalizeTableData(d);
      if (norm.data.length > 0) {
        pushTableSlide(
          getWidgetTitle(widget),
          norm,
          getWidgetSummary(widget),
          `Data: ${widget.widgetName}.`,
        );
        continue;
      }
    }

    const content =
      d?.content
      ?? d?.summary
      ?? stripHtml(d?.html)
      ?? (typeof d === 'string' ? d : '');
    const fallbackContent =
      typeof content === 'string' && content.trim().length > 0
        ? content
        : d?.widgetType === 'text_block'
          ? 'Empty note'
          : '';
    if (!fallbackContent) continue;
    slides.push({
      id: generateId('slide'),
      layout: 'content',
      title: getWidgetTitle(widget),
      speakerNotes: `${widget.widgetName}: text content from the canvas.`,
      elements: [{
        id: generateId('text'),
        type: 'text',
        position: { x: 0.5, y: 1.0, w: 9, h: 5.5 },
        config: {
          type: 'text',
          content: fallbackContent,
          fontSize: 12,
          lineSpacing: 1.4,
        } as TextElementConfig,
      }],
    });
  }

  return slides;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReportBuilder({
  onClose,
  canvasWidgetData: canvasWidgetDataProp,
  canvasTitle,
  tenantId,
  initialDefinition,
  inline = false,
}: ReportBuilderProps) {
  const { toast } = useToast();
  const navigate = useNavigate();

  const getLatestCanvasData = useCallback((): CanvasWidgetLike[] => {
    const live = useCanvasDataStore.getState().getSnapshot() as CanvasWidgetLike[];
    if (!canvasWidgetDataProp?.length) return live;

    const propById = new Map(canvasWidgetDataProp.map((entry) => [entry.itemId, entry]));
    const mergedLive = live.map((entry) => {
      const meta = propById.get(entry.itemId);
      if (!meta) return entry;
      const metaData = meta.data as any;
      const liveData = entry.data as any;
      const periodLabel = metaData?._periodLabel;
      const enrichedData =
        periodLabel && typeof liveData === 'object' && liveData !== null && !liveData._periodLabel
          ? { ...liveData, _periodLabel: periodLabel }
          : entry.data;
      return {
        ...entry,
        data: enrichedData,
        layoutPosition: meta.layoutPosition,
        widgetType: meta.widgetType,
      };
    });

    if (mergedLive.length > 0) {
      const liveIds = new Set(mergedLive.map((entry) => entry.itemId));
      const extras = canvasWidgetDataProp
        .filter((entry) => !liveIds.has(entry.itemId))
        .map((entry) => ({
          itemId: entry.itemId,
          widgetName: entry.widgetName,
          category: entry.category,
          data: entry.data,
          updatedAt: Date.now(),
          layoutPosition: entry.layoutPosition,
          widgetType: entry.widgetType,
        }));
      return [...mergedLive, ...extras];
    }

    return canvasWidgetDataProp.map((entry) => ({
      itemId: entry.itemId,
      widgetName: entry.widgetName,
      category: entry.category,
      data: entry.data,
      updatedAt: Date.now(),
      layoutPosition: entry.layoutPosition,
      widgetType: entry.widgetType,
    }));
  }, [canvasWidgetDataProp]);

  // Track widget count and data version reactively (primitives, stable)
  const widgetCount = useCanvasDataStore((s) => Object.keys(s.widgets).length);
  const dataVersion = useCanvasDataStore((s) => s.dataVersion);

  // Build initial slides: if an initialDefinition is provided, use that
  // (hydrated with canvas data as a safety net); otherwise auto-populate from canvas.
  const buildInitialSlides = (): SlideDefinition[] => {
    const data = getLatestCanvasData();
    if (initialDefinition?.slides) {
      return hydrateSlideData(initialDefinition.slides, data);
    }
    if (data.length > 0) {
      return canvasWidgetsToSlides(data, canvasTitle);
    }
    return [createDefaultSlide('title'), createDefaultSlide('content')];
  };

  // Report state
  const [reportTitle, setReportTitle] = useState(
    initialDefinition?.title || canvasTitle || 'Untitled Report'
  );
  const [slides, setSlides] = useState<SlideDefinition[]>(buildInitialSlides);
  const [theme, setTheme] = useState<ReportTheme>(
    initialDefinition?.theme || REPORT_THEMES.professional
  );
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(
    slides[0]?.id || null
  );
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [showTemplateGallery, setShowTemplateGallery] = useState(false);
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Auto-sync slides with canvas data. The component stays mounted, so whenever
  // widgets report new data the slides rebuild automatically (debounced).
  const prevRenderableCountRef = useRef(0);
  const prevDataVersionRef = useRef(dataVersion);

  useEffect(() => {
    if (initialDefinition?.slides) return;
    if (widgetCount === 0 && prevRenderableCountRef.current === 0) return;

    const timer = setTimeout(() => {
      const data = getLatestCanvasData();
      const renderableCount = data.filter(hasRenderableData).length;

      // Rebuild when renderable count changes (widget added/removed/loaded)
      // or when dataVersion bumped (widget data updated)
      const countChanged = renderableCount !== prevRenderableCountRef.current;
      const versionChanged = dataVersion !== prevDataVersionRef.current;
      if (!countChanged && !versionChanged && prevRenderableCountRef.current > 0) return;
      if (renderableCount === 0 && prevRenderableCountRef.current === 0) return;

      prevRenderableCountRef.current = renderableCount;
      prevDataVersionRef.current = dataVersion;

      if (renderableCount === 0) {
        setSlides([createDefaultSlide('title'), createDefaultSlide('content')]);
        return;
      }

      const fresh = canvasWidgetsToSlides(data, canvasTitle);
      setSlides(fresh);
      setSelectedSlideId((prev) => fresh.find((s) => s.id === prev) ? prev : fresh[0]?.id || null);
      setSelectedElementId(null);
    }, 600);

    return () => clearTimeout(timer);
  }, [widgetCount, dataVersion, canvasTitle, initialDefinition, getLatestCanvasData]);

  // When a NEW initialDefinition arrives (e.g., user clicks "Generate Report" again),
  // update the builder state. Hydrate any missing data from canvas widgets as a safety net.
  const lastLoadedDefIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      initialDefinition?.id &&
      initialDefinition.id !== lastLoadedDefIdRef.current
    ) {
      lastLoadedDefIdRef.current = initialDefinition.id;
      const hydrated = hydrateSlideData(initialDefinition.slides || [], getLatestCanvasData());
      setSlides(hydrated);
      setReportTitle(initialDefinition.title || canvasTitle || 'Untitled Report');
      if (initialDefinition.theme) setTheme(initialDefinition.theme);
      setSelectedSlideId(hydrated[0]?.id || null);
      setSelectedElementId(null);
    }
  }, [initialDefinition, canvasTitle, getLatestCanvasData]);

  useEffect(() => {
    if (!canvasTitle) return;
    const lower = canvasTitle.toLowerCase();
    if (lower === 'untitled canvas' || lower === 'untitled report' || lower === 'canvas report') return;
    setReportTitle((prev) => {
      const prevLower = prev.toLowerCase();
      if (prevLower === 'untitled report' || prevLower === 'untitled canvas' || prevLower === 'canvas report') {
        return canvasTitle;
      }
      return prev;
    });
  }, [canvasTitle]);

  const selectedSlide = useMemo(
    () => slides.find((s) => s.id === selectedSlideId) || null,
    [slides, selectedSlideId]
  );


  // --- Slide operations ---
  const addSlide = useCallback((layout: SlideLayout = 'content') => {
    const newSlide = createDefaultSlide(layout);
    setSlides((prev) => [...prev, newSlide]);
    setSelectedSlideId(newSlide.id);
    setSelectedElementId(null);
  }, []);

  const deleteSlide = useCallback((slideId: string) => {
    setSlides((prev) => {
      if (prev.length <= 1) return prev;
      const filtered = prev.filter((s) => s.id !== slideId);
      if (selectedSlideId === slideId) {
        setSelectedSlideId(filtered[0]?.id || null);
      }
      return filtered;
    });
    setSelectedElementId(null);
  }, [selectedSlideId]);

  const duplicateSlide = useCallback((slideId: string) => {
    setSlides((prev) => {
      const idx = prev.findIndex((s) => s.id === slideId);
      if (idx === -1) return prev;
      const original = prev[idx];
      const dupe: SlideDefinition = {
        ...structuredClone(original),
        id: generateId('slide'),
        elements: original.elements.map((e) => ({ ...structuredClone(e), id: generateId(e.type) })),
      };
      const newSlides = [...prev];
      newSlides.splice(idx + 1, 0, dupe);
      setSelectedSlideId(dupe.id);
      return newSlides;
    });
  }, []);

  const updateSlide = useCallback(
    (updates: Partial<SlideDefinition>) => {
      if (!selectedSlideId) return;
      setSlides((prev) =>
        prev.map((s) => (s.id === selectedSlideId ? { ...s, ...updates } : s))
      );
    },
    [selectedSlideId]
  );

  // --- Element operations ---
  const addElement = useCallback(
    (type: SlideElementType) => {
      if (!selectedSlideId) return;
      const el = createDefaultElement(type);
      setSlides((prev) =>
        prev.map((s) =>
          s.id === selectedSlideId
            ? { ...s, elements: [...s.elements, el] }
            : s
        )
      );
      setSelectedElementId(el.id);
    },
    [selectedSlideId]
  );

  const updateElement = useCallback(
    (elementId: string, updates: Partial<SlideElement>) => {
      if (!selectedSlideId) return;
      setSlides((prev) =>
        prev.map((s) =>
          s.id === selectedSlideId
            ? {
                ...s,
                elements: s.elements.map((e) =>
                  e.id === elementId ? { ...e, ...updates } : e
                ),
              }
            : s
        )
      );
    },
    [selectedSlideId]
  );

  const deleteElement = useCallback(
    (elementId: string) => {
      if (!selectedSlideId) return;
      setSlides((prev) =>
        prev.map((s) =>
          s.id === selectedSlideId
            ? { ...s, elements: s.elements.filter((e) => e.id !== elementId) }
            : s
        )
      );
      if (selectedElementId === elementId) setSelectedElementId(null);
    },
    [selectedSlideId, selectedElementId]
  );

  // --- Export ---
  const handleExport = useCallback(
    async (format: 'pptx' | 'pdf') => {
      setIsExporting(true);
      try {
        const definition: ReportDefinition = {
          id: generateId('report'),
          title: reportTitle,
          theme,
          slides,
          metadata: {
            createdAt: new Date().toISOString(),
            dataAsOf: new Date().toISOString(),
            generatedBy: 'user',
          },
        };

        const tenantParam = tenantId ? `?tenant_id=${tenantId}` : '';
        const blob = await fetchBlob(
          `/api/workbench/reports/generate${tenantParam}`,
          { definition, format }
        );

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${reportTitle.replace(/[^a-z0-9]/gi, '_')}.${format}`;
        a.click();
        URL.revokeObjectURL(url);

        toast({ title: 'Report exported', description: `Saved as ${format.toUpperCase()}` });
      } catch (err: any) {
        console.error('[ReportBuilder] Export failed:', err);
        toast({
          title: 'Export failed',
          description: err.response?.data?.error || err.message || 'Could not export report',
          variant: 'destructive',
        });
      } finally {
        setIsExporting(false);
      }
    },
    [reportTitle, theme, slides, tenantId, toast]
  );

  // --- Template loading ---
  const handleSelectTemplate = useCallback(
    (template: ReportTemplate) => {
      setReportTitle(template.definition.title || template.name);
      setSlides(
        template.definition.slides.map((s) => ({
          ...s,
          id: generateId('slide'),
          elements: s.elements.map((e) => ({ ...e, id: generateId(e.type) })),
        }))
      );
      if (template.definition.theme) {
        setTheme(template.definition.theme);
      }
      setSelectedSlideId(null);
      setSelectedElementId(null);
      setShowTemplateGallery(false);
      toast({ title: 'Template loaded', description: template.name });
    },
    [toast]
  );

  // --- Cohi AI Assist ---
  const [aiPrompt, setAiPrompt] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const aiInputRef = useRef<HTMLInputElement>(null);

  const handleCohiAssist = useCallback(async (prompt?: string) => {
    const userPrompt = prompt || aiPrompt.trim();
    if (!userPrompt) return;
    setIsAiLoading(true);
    setAiPrompt('');

    // Detect whether this is an additive operation (narratives, notes) that
    // should preserve existing data-rich slides, vs a full-deck rewrite.
    const lowerPrompt = userPrompt.toLowerCase();
    const isAdditiveOp =
      lowerPrompt.includes('add narrative') ||
      lowerPrompt.includes('speaker note') ||
      lowerPrompt.includes('talking point') ||
      lowerPrompt.includes('enhance every slide');

    // Snapshot current data-rich elements so we can re-inject them if the AI drops them.
    const dataRichElements = new Map<string, SlideElement[]>();
    for (const slide of slides) {
      const rich = slide.elements.filter((el) => {
        const cfg = el.config as any;
        if (!cfg) return false;
        if (cfg.type === 'chart' && Array.isArray(cfg.data) && cfg.data.length > 0) return true;
        if (cfg.type === 'table' && Array.isArray(cfg.data) && cfg.data.length > 0) return true;
        if (cfg.type === 'kpi' && cfg.value != null && cfg.value !== '--' && cfg.value !== 0) return true;
        return false;
      });
      if (rich.length > 0) dataRichElements.set(slide.title || slide.id, rich);
    }

    try {
      // Send full slide structure (with element configs) so the AI can preserve them.
      // Strip large data arrays to keep the payload manageable.
      const slidesForPrompt = slides.map((s, i) => ({
        index: i,
        id: s.id,
        title: s.title,
        layout: s.layout,
        speakerNotes: s.speakerNotes || '',
        elements: s.elements.map((e) => {
          const cfg = e.config as any;
          if (!cfg) return { id: e.id, type: e.type, position: e.position };
          const summary: any = { id: e.id, type: cfg.type || e.type, position: e.position };
          if (cfg.type === 'text') summary.content = cfg.content;
          if (cfg.type === 'kpi') { summary.label = cfg.label; summary.value = cfg.value; summary.format = cfg.format; }
          if (cfg.type === 'chart') { summary.chartType = cfg.chartType; summary.title = cfg.title; summary.hasData = !!(cfg.data?.length); summary.xKey = cfg.xKey; summary.yKeys = cfg.yKeys; }
          if (cfg.type === 'table') { summary.columns = cfg.columns; summary.hasData = !!(cfg.data?.length); summary.rowCount = cfg.data?.length || 0; }
          return summary;
        }),
      }));

      const latestData = getLatestCanvasData();
      const widgetData = latestData.map((entry) => ({
        itemId: entry.itemId,
        widgetName: entry.widgetName,
        category: entry.category,
        data: entry.data,
      }));

      const canvasState = {
        groups: [],
        standaloneWidgets: [],
        totalItems: latestData.length,
        widgetData: widgetData.length ? widgetData : undefined,
      };

      const instruction = isAdditiveOp
        ? `The user is in the Report Builder editing a report titled "${reportTitle}" with ${slides.length} slides. Current slides structure: ${JSON.stringify(slidesForPrompt)}. The user asks: "${userPrompt}". CRITICAL: You MUST preserve every existing slide and ALL of its elements exactly as-is (especially chart, table, and kpi elements — do NOT remove or replace them). Only ADD new text elements or update speakerNotes. Never drop data-rich elements. Return a generate_report action with all slides.`
        : `The user is in the Report Builder editing a report titled "${reportTitle}" with ${slides.length} slides. Current slides structure: ${JSON.stringify(slidesForPrompt)}. The user asks: "${userPrompt}". Respond with a generate_report action. IMPORTANT: Preserve all chart, table, and kpi elements from existing slides — do NOT replace them with text summaries. You may add, reorder, or restyle slides, add narrative text elements, and update speakerNotes. For chart/table/kpi elements, keep their type, position, and config fields intact (the system will fill in data). Include all slides.`;

      const tenantParam = tenantId ? `?tenant_id=${tenantId}` : '';
      const aiResponse = await api.request<{
        message?: string;
        actions?: Array<{ type: string; reportDefinition?: any; format?: string }>;
      }>(
        `/api/cohi-chat/workbench${tenantParam}`,
        {
          method: 'POST',
          body: JSON.stringify({
            question: instruction,
            canvasState,
            widgetCatalog: '',
            conversationHistory: [],
          }),
        }
      );

      const reportAction = aiResponse.actions?.find(
        (a) => a.type === 'generate_report'
      );

      if (reportAction?.reportDefinition?.slides?.length) {
        let newSlides: SlideDefinition[] = reportAction.reportDefinition.slides.map((s: any) => ({
          ...s,
          id: s.id || generateId('slide'),
          elements: (s.elements || []).map((e: any) => ({
            ...e,
            id: e.id || generateId(e.type || 'el'),
          })),
        }));

        // Hydrate AI slides with real canvas data (fills in empty chart/table/kpi data)
        newSlides = hydrateSlideData(newSlides, latestData);

        // Re-inject data-rich elements that the AI may have dropped.
        // For each original slide title that had data elements, check if the
        // corresponding new slide still has them — if not, append them.
        for (const [slideTitle, richEls] of dataRichElements) {
          const matchingSlide = newSlides.find(
            (s) => s.title === slideTitle || s.title?.toLowerCase().replace(/[^a-z0-9]/g, '') === slideTitle.toLowerCase().replace(/[^a-z0-9]/g, '')
          );
          if (matchingSlide) {
            for (const orig of richEls) {
              const origCfg = orig.config as any;
              const alreadyExists = matchingSlide.elements.some((el) => {
                const cfg = el.config as any;
                if (!cfg) return false;
                return cfg.type === origCfg.type && (
                  (cfg.type === 'chart' && Array.isArray(cfg.data) && cfg.data.length > 0) ||
                  (cfg.type === 'table' && Array.isArray(cfg.data) && cfg.data.length > 0) ||
                  (cfg.type === 'kpi' && cfg.value != null && cfg.value !== '--' && cfg.value !== 0)
                );
              });
              if (!alreadyExists) {
                matchingSlide.elements.push({ ...orig, id: orig.id || generateId(origCfg.type || 'el') });
              }
            }
          }
        }

        // For additive ops, also ensure we haven't lost any slides from the original deck.
        if (isAdditiveOp) {
          const newSlideTitles = new Set(newSlides.map((s) => s.title?.toLowerCase().replace(/[^a-z0-9]/g, '')));
          for (const origSlide of slides) {
            const origKey = origSlide.title?.toLowerCase().replace(/[^a-z0-9]/g, '') || origSlide.id;
            if (!newSlideTitles.has(origKey)) {
              newSlides.push(origSlide);
            }
          }
        }

        setSlides(newSlides);
        if (reportAction.reportDefinition.title) {
          setReportTitle(reportAction.reportDefinition.title);
        }
        if (reportAction.reportDefinition.theme) {
          setTheme(reportAction.reportDefinition.theme);
        }
        setSelectedSlideId(newSlides[0]?.id || null);
        setSelectedElementId(null);
        toast({
          title: 'Cohi updated the report',
          description: aiResponse.message || `Applied AI changes: ${newSlides.length} slides.`,
        });
      } else {
        toast({
          title: 'Cohi says',
          description: aiResponse.message || 'I couldn\'t modify the report. Try a more specific request.',
        });
      }
    } catch (err: any) {
      console.error('[ReportBuilder] Cohi assist error:', err);
      toast({
        title: 'AI assist failed',
        description: err.message || 'Could not get AI response. Try again.',
        variant: 'destructive',
      });
    } finally {
      setIsAiLoading(false);
    }
  }, [aiPrompt, slides, reportTitle, getLatestCanvasData, tenantId, toast]);

  return (
    <div className={cn(
      'bg-white dark:bg-slate-900 flex flex-col',
      inline ? 'w-full h-full' : 'fixed inset-0 z-50'
    )}>
      {/* Top bar */}
      <div className="h-10 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 px-3 bg-white dark:bg-slate-900 shrink-0">
        {/* Report title */}
        <input
          type="text"
          value={reportTitle}
          onChange={(e) => setReportTitle(e.target.value)}
          className="text-sm font-semibold bg-transparent border-none outline-none px-2 py-1 min-w-[200px] text-slate-800 dark:text-slate-100"
          placeholder="Report title..."
        />

        <div className="flex-1" />

        {/* Theme picker */}
        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => setShowThemePicker(!showThemePicker)}
          >
            <Palette className="h-3.5 w-3.5" />
            Theme
          </Button>
          {showThemePicker && (
            <div className="absolute right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg p-3 z-50 w-56">
              <div className="text-xs font-semibold mb-2 text-slate-600">Select Theme</div>
              {Object.entries(REPORT_THEMES).map(([key, t]) => (
                <button
                  key={key}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-slate-50 dark:hover:bg-slate-700',
                    theme.name === t.name && 'bg-blue-50 dark:bg-blue-900/30 ring-1 ring-blue-200'
                  )}
                  onClick={() => { setTheme(t); setShowThemePicker(false); }}
                >
                  <div className="flex gap-0.5">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: t.primaryColor }} />
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: t.accentColor }} />
                  </div>
                  <span className="text-slate-700 dark:text-slate-200">{t.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={() => setShowTemplateGallery(true)}
        >
          <LayoutTemplate className="h-3.5 w-3.5" />
          Templates
        </Button>

        <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" />

        {/* Export buttons */}
        <Button
          variant="default"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={() => handleExport('pptx')}
          disabled={isExporting}
        >
          <Presentation className="h-3.5 w-3.5" />
          {isExporting ? 'Exporting...' : 'Export PPTX'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={() => navigate('/workbench/distributions')}
        >
          <Mail className="h-3.5 w-3.5" />
          Schedule distribution
        </Button>
        <Button variant="ghost" size="sm" className="gap-1.5 text-xs ml-2" onClick={onClose}>
          <ArrowLeft className="h-4 w-4" />
          Back to Canvas
        </Button>
      </div>

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Slide panel (left) */}
        <SlidePanel
          slides={slides}
          selectedSlideId={selectedSlideId}
          onSelectSlide={(id) => { setSelectedSlideId(id); setSelectedElementId(null); }}
          onAddSlide={addSlide}
          onDeleteSlide={deleteSlide}
          onDuplicateSlide={duplicateSlide}
          onReorderSlides={setSlides}
          onAiEnhanceSlide={(slideId, prompt) => {
            setSelectedSlideId(slideId);
            handleCohiAssist(prompt);
          }}
          isAiLoading={isAiLoading}
        />

        {/* Slide editor (center) */}
        <SlideEditor
          slide={selectedSlide}
          theme={theme}
          selectedElementId={selectedElementId}
          onSelectElement={setSelectedElementId}
          onUpdateElement={updateElement}
          onAddElement={addElement}
          onDeleteElement={deleteElement}
          onUpdateSlide={updateSlide}
        />
      </div>

      {/* Cohi AI Assist bar */}
      <div className="h-12 border-t border-slate-200 dark:border-slate-700 flex items-center gap-2 px-3 bg-gradient-to-r from-indigo-50/80 to-purple-50/80 dark:from-indigo-950/40 dark:to-purple-950/40 shrink-0">
        <Sparkles className="h-4 w-4 text-indigo-500 shrink-0" />
        <input
          ref={aiInputRef}
          type="text"
          value={aiPrompt}
          onChange={(e) => setAiPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !isAiLoading) handleCohiAssist(); }}
          placeholder={isAiLoading ? 'Cohi is preparing...' : '"Make this more board-level", "Focus on credit risk", "Add a risk analysis slide"...'}
          disabled={isAiLoading}
          className="flex-1 text-sm bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-indigo-300 dark:focus:ring-indigo-700 disabled:opacity-50 placeholder:text-slate-400"
        />
        <Button
          variant="default"
          size="sm"
          className="gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 shrink-0"
          onClick={() => handleCohiAssist()}
          disabled={isAiLoading || !aiPrompt.trim()}
        >
          {isAiLoading ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Preparing...</>
          ) : (
            <><Send className="h-3.5 w-3.5" /> Ask Cohi</>
          )}
        </Button>
        {/* Quick action buttons — executive-oriented refinements */}
        <div className="flex gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[10px] text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/30"
            onClick={() => handleCohiAssist('Prepare a complete board-ready executive presentation from the canvas data. Lead every slide with a narrative paragraph explaining what happened, why it matters, and what requires attention. Use mortgage industry language. Include an executive summary, supporting visuals, and a final recommendations slide with specific action items.')}
            disabled={isAiLoading}
          >
            Board Briefing
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[10px] text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/30"
            onClick={() => handleCohiAssist('Enhance every slide with executive narrative commentary. For each slide, add a text element at the top explaining the insight: what the data shows, why it matters, and what the audience should take away. Write in mortgage industry language.')}
            disabled={isAiLoading}
          >
            Add Narratives
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[10px] text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/30"
            onClick={() => handleCohiAssist('Add detailed speaker notes to every slide with 3-4 talking points each. Notes should help a mortgage executive present this to a board or committee. Include specific data points to mention and anticipate questions.')}
            disabled={isAiLoading}
          >
            Speaker Notes
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[10px] text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/30"
            onClick={() => handleCohiAssist('Rewrite this report for the credit committee. Focus on credit risk analysis, DTI/FICO trends, fallout concentration, and compliance considerations. Use risk-aware language appropriate for a committee presentation.')}
            disabled={isAiLoading}
          >
            Credit Committee
          </Button>
        </div>
      </div>

      {/* Template Gallery */}
      {showTemplateGallery && (
        <ReportTemplateGallery
          onClose={() => setShowTemplateGallery(false)}
          onSelectTemplate={handleSelectTemplate}
          tenantId={tenantId}
        />
      )}
    </div>
  );
}

export default ReportBuilder;
