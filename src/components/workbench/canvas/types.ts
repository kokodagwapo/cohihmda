/**
 * Canvas layout and widget types for Workbench Canvas
 */

import type { VisualizationConfig } from '@/hooks/useCohiChat';
import type { SectionType } from '@/stores/widgetSectionStore';

/** Single upload record for canvas (file analyzed via /api/data-chat/analyze-file) */
export interface CanvasUpload {
  id: string;
  filename: string;
  mimeType: string;
  uploadedAt: string;
  analysis?: string;
  visualization?: VisualizationConfig;
}

/** Canvas background: color (hex), image (data URL or URL), or template id */
export type CanvasBackground =
  | { type: 'color'; value: string }
  | { type: 'image'; value: string }
  | { type: 'template'; value: string };

/** Text annotation style (fonts, weight, etc.) */
export interface CanvasTextAnnotationStyle {
  fontSize?: number;
  fill?: string;
  fontFamily?: string;
  fontWeight?: string | number;
  fontStyle?: 'normal' | 'italic';
  textAnchor?: 'start' | 'middle' | 'end';
}

/** Single annotation on the canvas (SVG overlay) */
export type CanvasAnnotation =
  | { id: string; type: 'text'; x: number; y: number; text: string; style?: CanvasTextAnnotationStyle }
  | { id: string; type: 'rect'; x: number; y: number; width: number; height: number; style?: { fill?: string; stroke?: string } }
  | { id: string; type: 'circle'; x: number; y: number; r: number; style?: { fill?: string; stroke?: string } }
  | { id: string; type: 'ellipse'; x: number; y: number; rx: number; ry: number; style?: { fill?: string; stroke?: string } }
  | { id: string; type: 'line'; x: number; y: number; x2: number; y2: number; style?: { stroke?: string } };

export type CanvasWidgetType =
  | 'chart'
  | 'kpi'
  | 'table'
  | 'dashboard_section'
  | 'registry_widget'
  | 'section_header'
  | 'widget_group'
  | 'pinned_insight'
  | 'news_card'
  | 'text_block'
  | 'rich_text'
  | 'image'
  | 'cohi_widget';

export interface CanvasLayoutItem {
  i: string;
  /** pixel-based position */
  x: number;
  y: number;
  /** pixel-based size */
  w: number;
  h: number;
  type: CanvasWidgetType;
  payload: CanvasWidgetPayload;
}

export type CanvasWidgetPayload =
  | { type: 'chart'; config: VisualizationConfig }
  | { type: 'kpi'; label: string; value: number | string; format?: 'number' | 'currency' | 'percent' }
  | { type: 'table'; columns: { key: string; label: string }[]; data: any[] }
  | { type: 'dashboard_section'; sectionId: string; title: string; hiddenSections?: string[]; displayMode?: 'full' | 'compact' | 'hidden' }
  | { type: 'registry_widget'; definitionId: string; sectionId?: string; config?: Record<string, unknown> }
  | { type: 'section_header'; sectionId: string; title: string; sectionType: SectionType }
  | {
      type: 'widget_group';
      /** Unique group identifier – keys into widgetSectionStore for filters */
      groupId: string;
      /** Display title for the group header */
      title: string;
      /** Data source type – controls which data hooks respond to this group's filters */
      sectionType: SectionType;
      /** Widget definition IDs to render inside the group */
      widgetIds: string[];
      /** Per-widget grid layout overrides (react-grid-layout format, grid-unit coords) */
      widgetLayouts?: Record<string, { x: number; y: number; w: number; h: number }>;
      /** Grid config version – stale layouts from older configs are auto-discarded */
      layoutVersion?: number;
      /** Whether the group body is collapsed */
      collapsed?: boolean;
    }
  | { type: 'pinned_insight'; title: string; content: string; visualization?: VisualizationConfig }
  | { type: 'news_card'; title: string; summary: string; link?: string }
  | { type: 'text_block'; content: string; title?: string }
  | { type: 'rich_text'; html: string }
  | { type: 'image'; src: string; alt?: string }
  | { type: 'cohi_widget'; sql: string; title: string; vizConfig: VisualizationConfig; explanation?: string };

export const DEFAULT_LAYOUT_ITEM: Partial<CanvasLayoutItem> = {
  w: 360,
  h: 240,
};

export function createLayoutItem(
  i: string,
  type: CanvasLayoutItem['type'],
  payload: CanvasLayoutItem['payload'],
  overrides?: Partial<Pick<CanvasLayoutItem, 'x' | 'y' | 'w' | 'h'>>
): CanvasLayoutItem {
  return {
    i,
    x: 0,
    y: 0,
    w: 360,
    h: 240,
    type,
    payload,
    ...overrides,
  };
}
