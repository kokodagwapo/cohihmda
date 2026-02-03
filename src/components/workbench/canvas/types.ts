/**
 * Canvas layout and widget types for Workbench Canvas
 */

import type { VisualizationConfig } from '@/hooks/useCohiChat';

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
  | 'pinned_insight'
  | 'news_card'
  | 'text_block'
  | 'rich_text'
  | 'image';

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
  | { type: 'pinned_insight'; title: string; content: string; visualization?: VisualizationConfig }
  | { type: 'news_card'; title: string; summary: string; link?: string }
  | { type: 'text_block'; content: string; title?: string }
  | { type: 'rich_text'; html: string }
  | { type: 'image'; src: string; alt?: string };

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
