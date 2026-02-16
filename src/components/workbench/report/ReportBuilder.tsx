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
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  Download,
  Presentation,
  FileText,
  Palette,
  LayoutTemplate,
  Save,
  Sparkles,
  Trash2,
  Send,
  Loader2,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

/** Authenticated POST returning a Blob (for binary PPTX/PDF downloads). */
async function fetchBlob(endpoint: string, body: object): Promise<Blob> {
  const token = localStorage.getItem('auth_token');
  const baseUrl = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3001' : '');
  const url = baseUrl ? `${baseUrl}${endpoint}` : endpoint;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
} from '@/types/reportTypes';
import { REPORT_THEMES } from '@/types/reportTypes';
import type { WidgetDataEntry } from '@/stores/canvasDataStore';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ReportBuilderProps {
  onClose: () => void;
  canvasWidgetData?: WidgetDataEntry[];
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
  colors: string[];
  title?: string;
} {
  // Shape A – widget registry ChartData (has xAxisKey / series)
  if (widgetData?.xAxisKey || widgetData?.series) {
    return {
      chartType: widgetData.chartType || 'bar',
      data: widgetData.data || [],
      xKey: widgetData.xAxisKey || '',
      yKey: widgetData.series?.[0]?.dataKey || '',
      yKeys: (widgetData.series || []).map((s: any) => s.dataKey),
      colors: (widgetData.series || []).map((s: any) => s.color).filter(Boolean),
      title: widgetData.title,
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
      colors: widgetData.colors || [],
      title: widgetData.title,
    };
  }
  // Shape C – already normalised / AI-generated
  return {
    chartType: widgetData?.chartType || widgetData?.type || 'bar',
    data: widgetData?.data || [],
    xKey: widgetData?.xKey || '',
    yKey: widgetData?.yKey || '',
    yKeys: widgetData?.yKeys || (widgetData?.yKey ? [widgetData.yKey] : []),
    colors: widgetData?.colors || [],
    title: widgetData?.title,
  };
}

/**
 * Normalise table widget data into the canonical { columns, data } shape.
 * TableData uses `rows`, but report elements expect `data`.
 */
function normalizeTableData(widgetData: any): { columns: any[]; data: any[] } {
  return {
    columns: widgetData?.columns || [],
    data: widgetData?.rows || widgetData?.data || [],
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
  const tables = canvasWidgets.filter((w) => w.category === 'table');

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
                chartType: cfg.chartType || norm.chartType,
              },
            };
          }
          // If no title match, use the first available chart data as fallback
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
 * Convert canvas widget data into report slides (client-side).
 * Produces a structured set of slides: Title -> Executive Summary -> KPIs -> Charts -> Tables -> Takeaways.
 */
function canvasWidgetsToSlides(
  widgets: WidgetDataEntry[],
  canvasTitle?: string
): SlideDefinition[] {
  const slides: SlideDefinition[] = [];

  // Title slide
  slides.push({
    id: generateId('slide'),
    layout: 'title',
    title: canvasTitle || 'Canvas Report',
    subtitle: `Generated from Cohi Workbench — ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    elements: [],
    speakerNotes: 'Title slide for the report generated from the current canvas.',
  });

  const kpis = widgets.filter((w) => w.category === 'kpi');
  const charts = widgets.filter((w) => w.category === 'chart');
  const tables = widgets.filter((w) => w.category === 'table');

  // Executive Summary slide with KPI overview
  if (kpis.length > 0) {
    const summaryLines = kpis.map((kpi) => {
      const rawVal = kpi.data?.value ?? kpi.data ?? '--';
      const fmt = kpi.data?.format || 'number';
      const val = fmtKpi(rawVal, fmt);
      const change = kpi.data?.change;
      const changeStr = change != null
        ? ` (${change >= 0 ? '+' : ''}${typeof change === 'number' ? change.toFixed(1) : change}%)`
        : '';
      return `\u2022 ${kpi.widgetName}: ${val}${changeStr}`;
    }).join('\n');

    slides.push({
      id: generateId('slide'),
      layout: 'content',
      title: 'Executive Summary',
      speakerNotes: 'High-level overview of key metrics. Highlight the most important trends and areas requiring attention.',
      elements: [{
        id: generateId('text'),
        type: 'text',
        position: { x: 0.5, y: 1.0, w: 9, h: 5.0 },
        config: {
          type: 'text',
          content: `Key Metrics Overview\n\n${summaryLines}`,
          fontSize: 13,
          lineSpacing: 1.5,
        } as TextElementConfig,
      }],
    });
  }

  // KPI grid slide
  if (kpis.length > 0) {
    const cols = Math.min(kpis.length, 4);
    slides.push({
      id: generateId('slide'),
      layout: 'kpi-grid',
      title: 'Key Metrics',
      speakerNotes: 'Detailed KPI metrics from the canvas. Discuss trends and compare against targets.',
      elements: kpis.slice(0, 8).map((kpi, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const itemW = 8.5 / cols;
        return {
          id: generateId('kpi'),
          type: 'kpi' as const,
          position: { x: 0.5 + col * itemW + 0.05, y: 1.0 + row * 1.5 + 0.05, w: itemW - 0.1, h: 1.3 },
          config: {
            type: 'kpi',
            label: kpi.widgetName,
            value: kpi.data?.value ?? kpi.data ?? '--',
            format: kpi.data?.format || 'number',
            change: kpi.data?.change,
          } as KpiElementConfig,
        };
      }),
    });
  }

  // Chart slides (1 per chart)
  charts.forEach((chart) => {
    const norm = normalizeChartData(chart.data);
    slides.push({
      id: generateId('slide'),
      layout: 'chart-focus',
      title: chart.widgetName,
      speakerNotes: `Chart: ${chart.widgetName}. Discuss the trends and notable data points visible in this visualization.`,
      elements: [{
        id: generateId('chart'),
        type: 'chart',
        position: { x: 0.5, y: 1.0, w: 9, h: 5.0 },
        config: {
          type: 'chart',
          chartType: norm.chartType,
          title: chart.widgetName,
          data: norm.data,
          xKey: norm.xKey,
          yKey: norm.yKey,
          yKeys: norm.yKeys,
          colors: norm.colors.length ? norm.colors : undefined,
          showLegend: true,
        } as ChartElementConfig,
      }],
    });
  });

  // Table slides (1 per table)
  tables.forEach((table) => {
    const norm = normalizeTableData(table.data);
    slides.push({
      id: generateId('slide'),
      layout: 'table',
      title: table.widgetName,
      speakerNotes: `Data table: ${table.widgetName}. Review the detailed data and highlight key rows.`,
      elements: [{
        id: generateId('table'),
        type: 'table',
        position: { x: 0.5, y: 1.0, w: 9, h: 5.5 },
        config: {
          type: 'table',
          columns: norm.columns,
          data: norm.data,
        } as TableElementConfig,
      }],
    });
  });

  // Key Takeaways slide
  const takeaways: string[] = [];
  for (const kpi of kpis) {
    const change = kpi.data?.change;
    if (change != null && typeof change === 'number' && Math.abs(change) >= 5) {
      const direction = change >= 0 ? 'increased' : 'decreased';
      takeaways.push(`${kpi.widgetName} ${direction} by ${Math.abs(change).toFixed(1)}% — ${change >= 0 ? 'positive trend to maintain' : 'investigate root cause'}`);
    }
  }
  if (takeaways.length === 0) {
    takeaways.push('Review the data presented for actionable insights');
    takeaways.push('Compare metrics against prior period targets');
    takeaways.push('Schedule follow-up discussion with stakeholders');
  }

  slides.push({
    id: generateId('slide'),
    layout: 'content',
    title: 'Key Takeaways & Next Steps',
    speakerNotes: 'Summarize the main findings and outline recommended action items.',
    elements: [{
      id: generateId('text'),
      type: 'text',
      position: { x: 0.5, y: 1.0, w: 9, h: 5.0 },
      config: {
        type: 'text',
        content: takeaways.map((item, i) => `${i + 1}. ${item}`).join('\n\n'),
        fontSize: 14,
        lineSpacing: 1.8,
      } as TextElementConfig,
    }],
  });

  return slides;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReportBuilder({
  onClose,
  canvasWidgetData,
  canvasTitle,
  tenantId,
  initialDefinition,
  inline = false,
}: ReportBuilderProps) {
  const { toast } = useToast();

  // Build initial slides: if an initialDefinition is provided, use that
  // (hydrated with canvas data as a safety net); otherwise auto-populate from canvas.
  const buildInitialSlides = (): SlideDefinition[] => {
    if (initialDefinition?.slides) {
      return hydrateSlideData(initialDefinition.slides, canvasWidgetData || []);
    }
    if (canvasWidgetData && canvasWidgetData.length > 0) {
      return canvasWidgetsToSlides(canvasWidgetData, canvasTitle);
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

  // When a NEW initialDefinition arrives (e.g., user clicks "Generate Report" again),
  // update the builder state. Hydrate any missing data from canvas widgets as a safety net.
  const lastLoadedDefIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      initialDefinition?.id &&
      initialDefinition.id !== lastLoadedDefIdRef.current
    ) {
      lastLoadedDefIdRef.current = initialDefinition.id;
      const hydrated = hydrateSlideData(initialDefinition.slides || [], canvasWidgetData || []);
      setSlides(hydrated);
      setReportTitle(initialDefinition.title || canvasTitle || 'Untitled Report');
      if (initialDefinition.theme) setTheme(initialDefinition.theme);
      setSelectedSlideId(hydrated[0]?.id || null);
      setSelectedElementId(null);
    }
  }, [initialDefinition, canvasTitle, canvasWidgetData]);

  const selectedSlide = useMemo(
    () => slides.find((s) => s.id === selectedSlideId) || null,
    [slides, selectedSlideId]
  );

  const selectedElement = useMemo(
    () => selectedSlide?.elements.find((e) => e.id === selectedElementId) || null,
    [selectedSlide, selectedElementId]
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

  // --- Import from Canvas ---
  const handleImportFromCanvas = useCallback(() => {
    if (!canvasWidgetData || canvasWidgetData.length === 0) {
      toast({ title: 'No canvas data', description: 'Add widgets to the canvas first.', variant: 'destructive' });
      return;
    }
    const imported = canvasWidgetsToSlides(canvasWidgetData, canvasTitle);
    setSlides(imported);
    setReportTitle(canvasTitle || 'Canvas Report');
    setSelectedSlideId(imported[0]?.id || null);
    setSelectedElementId(null);
    toast({ title: 'Canvas imported', description: `Imported ${canvasWidgetData.length} widget${canvasWidgetData.length !== 1 ? 's' : ''} into ${imported.length} slides.` });
  }, [canvasWidgetData, canvasTitle, toast]);

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

    try {
      // Build a context payload with current report state + canvas data
      const currentSlidesSummary = slides.map((s, i) => ({
        index: i,
        title: s.title,
        layout: s.layout,
        elementCount: s.elements.length,
        elementTypes: s.elements.map((e) => e.config?.type || e.type),
      }));

      const widgetData = canvasWidgetData?.map((entry) => ({
        itemId: entry.itemId,
        widgetName: entry.widgetName,
        category: entry.category,
        data: entry.data,
      }));

      const canvasState = {
        groups: [],
        standaloneWidgets: [],
        totalItems: canvasWidgetData?.length || 0,
        widgetData: widgetData?.length ? widgetData : undefined,
      };

      const tenantParam = tenantId ? `?tenant_id=${tenantId}` : '';
      const aiResponse = await api.request<{
        message?: string;
        actions?: Array<{ type: string; reportDefinition?: any; format?: string }>;
      }>(
        `/api/cohi-chat/workbench${tenantParam}`,
        {
          method: 'POST',
          body: JSON.stringify({
            question: `The user is in the Report Builder editing a report titled "${reportTitle}" with ${slides.length} slides. Current slides: ${JSON.stringify(currentSlidesSummary)}. The user asks: "${userPrompt}". Respond with a generate_report action containing the full updated slide deck. If the user asks to modify a specific slide, keep the other slides as-is but improve the one requested. If they ask for a new slide, add it. Always include all existing slides plus any changes.`,
            canvasState,
            widgetCatalog: '',
            conversationHistory: [],
          }),
        }
      );

      // Extract the generate_report action
      const reportAction = aiResponse.actions?.find(
        (a) => a.type === 'generate_report'
      );

      if (reportAction?.reportDefinition?.slides?.length) {
        const newSlides = reportAction.reportDefinition.slides.map((s: any) => ({
          ...s,
          id: s.id || generateId('slide'),
          elements: (s.elements || []).map((e: any) => ({
            ...e,
            id: e.id || generateId(e.type || 'el'),
          })),
        }));
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
        // AI responded but without a report action — show the message
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
  }, [aiPrompt, slides, reportTitle, canvasWidgetData, tenantId, toast]);

  // --- Properties panel for selected element ---
  const renderPropertiesPanel = () => {
    if (!selectedElement) {
      return (
        <div className="p-4 text-xs text-slate-400 text-center">
          Select an element to edit its properties
        </div>
      );
    }

    const config = selectedElement.config;

    return (
      <div className="p-3 space-y-3">
        <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase">
          {config.type} Properties
        </div>

        {/* Text properties */}
        {config.type === 'text' && (
          <>
            <div>
              <label className="text-[10px] text-slate-500 block mb-0.5">Content</label>
              <textarea
                value={(config as TextElementConfig).content || ''}
                onChange={(e) =>
                  updateElement(selectedElement.id, {
                    config: { ...config, content: e.target.value },
                  })
                }
                className="w-full text-xs border border-slate-200 rounded px-2 py-1 bg-white dark:bg-slate-800 resize-none h-20"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-slate-500 block mb-0.5">Font Size</label>
                <input
                  type="number"
                  value={(config as TextElementConfig).fontSize || 12}
                  onChange={(e) =>
                    updateElement(selectedElement.id, {
                      config: { ...config, fontSize: Number(e.target.value) },
                    })
                  }
                  className="w-full text-xs border border-slate-200 rounded px-2 py-1 bg-white dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 block mb-0.5">Align</label>
                <select
                  value={(config as TextElementConfig).align || 'left'}
                  onChange={(e) =>
                    updateElement(selectedElement.id, {
                      config: { ...config, align: e.target.value as 'left' | 'center' | 'right' },
                    })
                  }
                  className="w-full text-xs border border-slate-200 rounded px-1 py-1 bg-white dark:bg-slate-800"
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-slate-500">Bold</label>
              <input
                type="checkbox"
                checked={(config as TextElementConfig).fontWeight === 'bold'}
                onChange={(e) =>
                  updateElement(selectedElement.id, {
                    config: { ...config, fontWeight: e.target.checked ? 'bold' : 'normal' },
                  })
                }
              />
            </div>
          </>
        )}

        {/* KPI properties */}
        {config.type === 'kpi' && (
          <>
            <div>
              <label className="text-[10px] text-slate-500 block mb-0.5">Label</label>
              <input
                type="text"
                value={(config as KpiElementConfig).label || ''}
                onChange={(e) =>
                  updateElement(selectedElement.id, {
                    config: { ...config, label: e.target.value },
                  })
                }
                className="w-full text-xs border border-slate-200 rounded px-2 py-1 bg-white dark:bg-slate-800"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-slate-500 block mb-0.5">Value</label>
                <input
                  type="text"
                  value={String((config as KpiElementConfig).value ?? '')}
                  onChange={(e) =>
                    updateElement(selectedElement.id, {
                      config: { ...config, value: isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value) },
                    })
                  }
                  className="w-full text-xs border border-slate-200 rounded px-2 py-1 bg-white dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 block mb-0.5">Format</label>
                <select
                  value={(config as KpiElementConfig).format || 'number'}
                  onChange={(e) =>
                    updateElement(selectedElement.id, {
                      config: { ...config, format: e.target.value as 'number' | 'currency' | 'percent' },
                    })
                  }
                  className="w-full text-xs border border-slate-200 rounded px-1 py-1 bg-white dark:bg-slate-800"
                >
                  <option value="number">Number</option>
                  <option value="currency">Currency</option>
                  <option value="percent">Percent</option>
                </select>
              </div>
            </div>
          </>
        )}

        {/* Chart properties */}
        {config.type === 'chart' && (
          <>
            <div>
              <label className="text-[10px] text-slate-500 block mb-0.5">Chart Title</label>
              <input
                type="text"
                value={(config as ChartElementConfig).title || ''}
                onChange={(e) =>
                  updateElement(selectedElement.id, {
                    config: { ...config, title: e.target.value },
                  })
                }
                className="w-full text-xs border border-slate-200 rounded px-2 py-1 bg-white dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 block mb-0.5">Chart Type</label>
              <select
                value={(config as ChartElementConfig).chartType || 'bar'}
                onChange={(e) =>
                  updateElement(selectedElement.id, {
                    config: { ...config, chartType: e.target.value },
                  })
                }
                className="w-full text-xs border border-slate-200 rounded px-1 py-1 bg-white dark:bg-slate-800"
              >
                <option value="bar">Bar</option>
                <option value="line">Line</option>
                <option value="pie">Pie</option>
                <option value="area">Area</option>
                <option value="donut">Donut</option>
                <option value="horizontal_bar">Horizontal Bar</option>
                <option value="stacked_bar">Stacked Bar</option>
              </select>
            </div>
          </>
        )}

        {/* Position */}
        <div className="border-t border-slate-200 dark:border-slate-700 pt-2">
          <div className="text-[10px] text-slate-500 mb-1">Position (inches)</div>
          <div className="grid grid-cols-2 gap-1.5">
            {['x', 'y', 'w', 'h'].map((key) => (
              <div key={key}>
                <label className="text-[9px] text-slate-400 uppercase">{key}</label>
                <input
                  type="number"
                  step="0.1"
                  value={selectedElement.position[key as keyof typeof selectedElement.position]?.toFixed(2) || 0}
                  onChange={(e) =>
                    updateElement(selectedElement.id, {
                      position: { ...selectedElement.position, [key]: Number(e.target.value) },
                    })
                  }
                  className="w-full text-[10px] border border-slate-200 rounded px-1 py-0.5 bg-white dark:bg-slate-800"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Delete element */}
        <Button
          variant="destructive"
          size="sm"
          className="w-full text-xs gap-1 mt-2"
          onClick={() => deleteElement(selectedElement.id)}
        >
          <Trash2 className="h-3 w-3" /> Delete Element
        </Button>
      </div>
    );
  };

  return (
    <div className={cn(
      'bg-white dark:bg-slate-900 flex flex-col',
      inline ? 'w-full h-full' : 'fixed inset-0 z-50'
    )}>
      {/* Top bar */}
      <div className="h-10 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 px-3 bg-white dark:bg-slate-900 shrink-0">
        {!inline && (
          <>
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={onClose}>
              <ArrowLeft className="h-4 w-4" />
              Back to Canvas
            </Button>
            <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" />
          </>
        )}

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

        {canvasWidgetData && canvasWidgetData.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs border-blue-200 text-blue-600 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-900/30"
            onClick={handleImportFromCanvas}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Import from Canvas ({canvasWidgetData.length})
          </Button>
        )}

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
          onClick={() => handleExport('pdf')}
          disabled={isExporting}
        >
          <FileText className="h-3.5 w-3.5" />
          PDF
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

        {/* Properties panel (right) */}
        <div className="w-56 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 overflow-y-auto">
          <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
              Properties
            </span>
          </div>
          {renderPropertiesPanel()}
        </div>
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
