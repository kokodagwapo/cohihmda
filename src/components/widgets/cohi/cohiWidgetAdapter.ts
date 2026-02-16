/**
 * Cohi Chat Widget Adapter
 *
 * Converts Cohi Chat visualization responses into canvas-compatible widget payloads.
 * This enables the "Add to Workbench" action on Cohi chat responses.
 *
 * Two modes:
 * 1. **Direct chart/kpi/table widgets** – Cohi's VisualizationConfig is already
 *    compatible with the existing canvas chart/kpi/table types.
 * 2. **Registry widgets** – For standard dashboard KPIs (e.g. "show me total units"),
 *    Cohi can reference a widget definition by ID.
 */

import type { VisualizationConfig } from '@/hooks/useCohiChat';
import type { CanvasWidgetPayload, CanvasWidgetType } from '@/components/workbench/canvas/types';
import { getWidgetDefinition } from '@/components/widgets/registry';

// ---------------------------------------------------------------------------
// JSON Schema for widget configs that Cohi can output
// ---------------------------------------------------------------------------

/**
 * Schema definition for Cohi-generated widget configurations.
 * The backend AI can output JSON matching this schema to create widgets.
 */
export const COHI_WIDGET_SCHEMA = {
  type: 'object',
  properties: {
    widgetType: {
      type: 'string',
      enum: ['chart', 'kpi', 'table', 'registry_widget'],
      description: 'Type of widget to create',
    },
    // For registry_widget type
    definitionId: {
      type: 'string',
      description: 'Widget definition ID from the registry (e.g. "company-scorecard-units")',
    },
    // For chart type
    chartConfig: {
      type: 'object',
      description: 'VisualizationConfig for chart widgets',
    },
    // For kpi type
    kpiConfig: {
      type: 'object',
      properties: {
        label: { type: 'string' },
        value: { type: ['number', 'string'] },
        format: { type: 'string', enum: ['number', 'currency', 'percent'] },
      },
    },
    // For table type
    tableConfig: {
      type: 'object',
      properties: {
        columns: { type: 'array', items: { type: 'object' } },
        data: { type: 'array', items: { type: 'object' } },
      },
    },
    // Sizing
    size: {
      type: 'object',
      properties: {
        w: { type: 'number' },
        h: { type: 'number' },
      },
    },
  },
  required: ['widgetType'],
} as const;

export type CohiWidgetConfig = {
  widgetType: 'chart' | 'kpi' | 'table' | 'registry_widget';
  definitionId?: string;
  chartConfig?: VisualizationConfig;
  kpiConfig?: { label: string; value: number | string; format?: 'number' | 'currency' | 'percent' };
  tableConfig?: { columns: { key: string; label: string }[]; data: Record<string, unknown>[] };
  size?: { w: number; h: number };
};

// ---------------------------------------------------------------------------
// Conversion: Cohi VisualizationConfig -> Canvas Widget Payload
// ---------------------------------------------------------------------------

/**
 * Converts a Cohi chat visualization response into a canvas-compatible widget payload.
 */
export function visualizationToCanvasPayload(
  viz: VisualizationConfig,
): { type: CanvasWidgetType; payload: CanvasWidgetPayload; size: { w: number; h: number } } | null {
  if (!viz) return null;

  switch (viz.type) {
    case 'kpi':
      return {
        type: 'kpi',
        payload: {
          type: 'kpi' as const,
          label: viz.title ?? 'KPI',
          value: viz.data?.[0]?.value ?? 0,
          format: (viz as any).format ?? 'number',
        },
        size: { w: 200, h: 140 },
      };

    case 'table':
      return {
        type: 'table',
        payload: {
          type: 'table' as const,
          columns: (viz.columns ?? []).map((c) =>
            typeof c === 'string' ? { key: c, label: c } : c,
          ),
          data: viz.data ?? [],
        },
        size: { w: 480, h: 320 },
      };

    case 'bar':
    case 'line':
    case 'area':
    case 'pie':
    case 'donut':
    default:
      return {
        type: 'chart',
        payload: { type: 'chart' as const, config: viz },
        size: { w: 420, h: 300 },
      };
  }
}

/**
 * Converts a Cohi widget config (from AI JSON output) into a canvas widget payload.
 */
export function cohiConfigToCanvasPayload(
  config: CohiWidgetConfig,
): { type: CanvasWidgetType; payload: CanvasWidgetPayload; size: { w: number; h: number } } | null {
  switch (config.widgetType) {
    case 'registry_widget': {
      if (!config.definitionId) return null;
      const def = getWidgetDefinition(config.definitionId);
      if (!def) return null;
      return {
        type: 'registry_widget',
        payload: { type: 'registry_widget' as const, definitionId: config.definitionId },
        size: config.size ?? def.defaultSize,
      };
    }

    case 'kpi': {
      if (!config.kpiConfig) return null;
      return {
        type: 'kpi',
        payload: {
          type: 'kpi' as const,
          label: config.kpiConfig.label,
          value: config.kpiConfig.value,
          format: config.kpiConfig.format,
        },
        size: config.size ?? { w: 200, h: 140 },
      };
    }

    case 'table': {
      if (!config.tableConfig) return null;
      return {
        type: 'table',
        payload: {
          type: 'table' as const,
          columns: config.tableConfig.columns,
          data: config.tableConfig.data as any[],
        },
        size: config.size ?? { w: 480, h: 320 },
      };
    }

    case 'chart': {
      if (!config.chartConfig) return null;
      return {
        type: 'chart',
        payload: { type: 'chart' as const, config: config.chartConfig },
        size: config.size ?? { w: 420, h: 300 },
      };
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// "Add to Workbench" dispatcher
// ---------------------------------------------------------------------------

/**
 * Dispatches a custom event to add a widget to the workbench canvas.
 * Can be called from Cohi chat response actions.
 */
export function addVisualizationToWorkbench(viz: VisualizationConfig): boolean {
  const result = visualizationToCanvasPayload(viz);
  if (!result) return false;

  window.dispatchEvent(
    new CustomEvent('add-canvas-widget', {
      detail: {
        type: result.type,
        payload: result.payload,
        size: result.size,
      },
    }),
  );
  return true;
}

/**
 * Dispatches a custom event to add a registry widget to the workbench canvas.
 */
export function addRegistryWidgetToWorkbench(definitionId: string): boolean {
  const def = getWidgetDefinition(definitionId);
  if (!def) return false;

  window.dispatchEvent(
    new CustomEvent('add-registry-widget', {
      detail: {
        definitionId: def.id,
        name: def.name,
        defaultSize: def.defaultSize,
      },
    }),
  );
  return true;
}
