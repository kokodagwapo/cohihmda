/**
 * Utility to convert Cohi Chat messages into Workbench Canvas layout items.
 *
 * Used by the "Open in Workbench" feature: extracts all assistant messages
 * that contain visualizations and maps them to CanvasLayoutItem[].
 *
 * SQL-backed visualizations are placed inside a single WidgetGroup so they
 * automatically get the group's timeframe / date-field filter controls.
 * Non-SQL visualizations (static snapshots) fall back to standalone items.
 */

import type { ChatMessage, VisualizationConfig } from '@/hooks/useCohiChat';
import { createLayoutItem, type CanvasLayoutItem, type GroupWidgetItem } from '@/components/workbench/canvas/types';
import {
  WORKBENCH_LEGACY_CHART_ID,
  WORKBENCH_LEGACY_KPI_ID,
  WORKBENCH_LEGACY_TABLE_ID,
} from '@/components/widgets/registry/legacyWorkbenchWidgets';

/** Default widget sizes per type */
const WIDGET_SIZES = {
  widget_group: { w: 700, h: 500 },
  cohi_widget: { w: 480, h: 340 },
  chart: { w: 420, h: 280 },
  kpi: { w: 220, h: 140 },
  table: { w: 480, h: 300 },
} as const;

const GAP = 24;
const START_X = 20;
const START_Y = 20;
const MAX_CANVAS_WIDTH = 1020;

/**
 * Extracts visualizations from a chat conversation and converts them to
 * canvas layout items.
 *
 * SQL-backed messages are bundled into a single WidgetGroup.
 * Non-SQL messages (static data snapshots) remain standalone items.
 *
 * @param vizTypeOverrides - Optional map of message id -> chart type, used to
 *   preserve the user's chart-type selection from the chat panel design buttons.
 */
export function convertChatToCanvasItems(
  messages: ChatMessage[],
  vizTypeOverrides?: Record<string, VisualizationConfig['type']>,
): CanvasLayoutItem[] {
  const items: CanvasLayoutItem[] = [];

  const vizMessages = messages.filter(
    (m) => m.role === 'assistant' && m.visualization && !m.error,
  );

  // Split into SQL-backed (→ WidgetGroup) vs. static (→ standalone)
  const sqlMessages: ChatMessage[] = [];
  const staticMessages: ChatMessage[] = [];

  for (const message of vizMessages) {
    if (message.sqlQuery) {
      sqlMessages.push(message);
    } else {
      staticMessages.push(message);
    }
  }

  // ─── 1. Create a single WidgetGroup for all SQL-backed vizzes ───
  if (sqlMessages.length > 0) {
    const cohiItems: GroupWidgetItem[] = sqlMessages.map((message, idx) => {
      const override = vizTypeOverrides?.[message.id];
      const viz = override
        ? { ...message.visualization!, type: override }
        : message.visualization!;

      return {
        kind: 'cohi' as const,
        id: `chat-${message.id || idx}`,
        sql: message.sqlQuery!,
        title: viz.title || 'Chat Visualization',
        vizConfig: viz,
        explanation: truncate(message.content, 200),
      };
    });

    const groupId = `chat-export-group-${Date.now()}`;
    const groupItem = createLayoutItem(
      groupId,
      'widget_group',
      {
        type: 'widget_group',
        groupId,
        title: 'Cohi Chat Visualizations',
        sectionType: 'company-scorecard', // default section – gives full date filter set
        widgetIds: [], // no registry widgets
        items: cohiItems,
      },
      { x: START_X, y: START_Y, ...WIDGET_SIZES.widget_group },
    );

    // Scale group height based on item count
    if (cohiItems.length > 2) {
      groupItem.h = Math.min(900, WIDGET_SIZES.widget_group.h + (cohiItems.length - 2) * 180);
    }

    items.push(groupItem);
  }

  // ─── 2. Lay out static (non-SQL) items below the group ───
  let curX = START_X;
  let curY = items.length > 0 ? (items[0].y + items[0].h + GAP) : START_Y;
  let rowMaxH = 0;

  for (const message of staticMessages) {
    const override = vizTypeOverrides?.[message.id];
    const viz = override
      ? { ...message.visualization!, type: override }
      : message.visualization!;
    const item = buildStaticCanvasItem(message, viz, items.length);

    if (curX + item.w > MAX_CANVAS_WIDTH && curX > START_X) {
      curX = START_X;
      curY += rowMaxH + GAP;
      rowMaxH = 0;
    }

    item.x = curX;
    item.y = curY;
    items.push(item);

    curX += item.w + GAP;
    rowMaxH = Math.max(rowMaxH, item.h);
  }

  return items;
}

/**
 * Build a standalone CanvasLayoutItem for a non-SQL ChatMessage.
 */
function buildStaticCanvasItem(
  message: ChatMessage,
  viz: VisualizationConfig,
  index: number,
): CanvasLayoutItem {
  const baseId = `chat-export-${message.id || index}`;

  // KPI widget → legacy registry embed
  if ((viz.type === 'kpi' || viz.type === 'kpi-grid') && viz.kpiConfig) {
    const size = WIDGET_SIZES.kpi;
    return createLayoutItem(
      `${baseId}-kpi`,
      'registry_widget',
      {
        type: 'registry_widget',
        definitionId: WORKBENCH_LEGACY_KPI_ID,
        config: {
          label: viz.kpiConfig.label,
          value: viz.kpiConfig.value,
          format: viz.kpiConfig.format,
        },
      },
      { x: 0, y: 0, ...size },
    );
  }

  // Table widget → legacy registry embed
  if (viz.type === 'table' && viz.tableConfig) {
    const size = WIDGET_SIZES.table;
    return createLayoutItem(
      `${baseId}-table`,
      'registry_widget',
      {
        type: 'registry_widget',
        definitionId: WORKBENCH_LEGACY_TABLE_ID,
        config: {
          columns: viz.tableConfig.columns.map((c) => ({ key: c.key, label: c.label })),
          data: viz.data || [],
        },
      },
      { x: 0, y: 0, ...size },
    );
  }

  // Generic chart (static snapshot) → legacy registry embed
  const size = WIDGET_SIZES.chart;
  return createLayoutItem(
    `${baseId}-chart`,
    'registry_widget',
    {
      type: 'registry_widget',
      definitionId: WORKBENCH_LEGACY_CHART_ID,
      config: { vizConfig: viz },
    },
    { x: 0, y: 0, ...size },
  );
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}
