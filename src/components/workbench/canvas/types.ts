/**
 * Canvas layout and widget types for Workbench Canvas
 */

import type { VisualizationConfig } from '@/hooks/useCohiChat';
import type { SectionType, SectionFilters } from '@/stores/widgetSectionStore';

/** Single upload record for canvas (file analyzed via /api/cohi-chat/analyze-file) */
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

// ---------------------------------------------------------------------------
// Per-widget filter state (for Cohi SQL-backed widgets)
// ---------------------------------------------------------------------------

/**
 * Serialisable filter state that each Cohi widget can own independently.
 * When a widget has `savedFilters`, it controls its own date scoping
 * instead of inheriting from the parent group.  When `savedFilters` is
 * undefined, the widget starts with no filter (SQL's own WHERE clause).
 */
export interface WidgetFilterState {
  /** Date column to filter on ('application_date' | 'funding_date' | ...) */
  dateField?: string;
  /** Period preset key ('L12M' | 'YTD' | 'MTD' | ...) */
  preset?: string;
  /** Full-year filter (e.g. 2025) */
  year?: number;
  /** Explicit date range */
  dateRange?: { start: string; end: string };
  /** Per-widget dimension filters (branch, loan officer, etc.) */
  dimensionFilters?: Array<{ column: string; value: string }>;
}

// ---------------------------------------------------------------------------
// WidgetFilterConfig – AI-declared filter capabilities for a Cohi widget
// ---------------------------------------------------------------------------

/**
 * Declared at widget creation time by the AI. Describes whether the widget
 * supports external filter injection and which date column + default preset
 * to use. Filters are applied additively (no SQL rewriting).
 */
export interface WidgetFilterConfig {
  /** When true, date and dimension filters can be injected into this widget's SQL. */
  filterable: boolean;
  /**
   * The primary date column to filter on.
   * e.g. "application_date", "funding_date", "lock_date"
   */
  dateColumn?: string;
  /**
   * The default time preset to apply when the widget is first rendered.
   * Maps to period presets: "L12M" | "L6M" | "L3M" | "YTD" | "MTD" | "CY" | "PY" | null
   */
  defaultPreset?: string | null;
}

// ---------------------------------------------------------------------------
// GroupWidgetItem – polymorphic items that live inside a WidgetGroup
// ---------------------------------------------------------------------------

/** An item inside a WidgetGroup – either a registry widget or a SQL-backed Cohi widget */
export type GroupWidgetItem =
  | { kind: 'registry'; defId: string; config?: Record<string, unknown> }
  | {
      kind: 'cohi';
      /** Stable id for this item within the group */
      id: string;
      sql: string;
      title: string;
      vizConfig: VisualizationConfig;
      explanation?: string;
      /**
       * AI-declared filter config (set at creation, never changes).
       * Determines whether filters can be applied and which date column to use.
       */
      filterConfig?: WidgetFilterConfig;
      /** Per-widget filter state. When present, the widget uses its own filters. */
      savedFilters?: WidgetFilterState;
    };

// ---------------------------------------------------------------------------
// Canvas widget payloads
// ---------------------------------------------------------------------------

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
      /**
       * @deprecated Use `items` instead.  Kept for backward compatibility –
       * if present and `items` is absent, each entry is treated as a registry defId.
       */
      widgetIds: string[];
      /** Mixed items: registry widgets and/or SQL-backed Cohi widgets */
      items?: GroupWidgetItem[];
      /** Per-widget grid layout overrides (react-grid-layout format, grid-unit coords) */
      widgetLayouts?: Record<string, { x: number; y: number; w: number; h: number }>;
      /** Grid config version – stale layouts from older configs are auto-discarded */
      layoutVersion?: number;
      /** Whether the group body is collapsed */
      collapsed?: boolean;
      /** Whether the filter bar starts collapsed (compact mode for deep-dive canvases) */
      filtersCollapsed?: boolean;
      /**
       * When true (default for existing canvases), all widgets share the
       * group's master filter.  When false, each Cohi widget uses its own
       * independent filter bar.  Registry widgets always use group filters.
       */
      filterSync?: boolean;
      /**
       * When true, viewers cannot change this group's filters.
       * Owners/editors can still update filters and can toggle this lock.
       */
      filterLocked?: boolean;
      /** Persisted filter state (year, dateRange, periodSelection, dateField, etc.) */
      savedFilters?: Partial<SectionFilters>;
    }
  | { type: 'pinned_insight'; title: string; content: string; visualization?: VisualizationConfig }
  | { type: 'news_card'; title: string; summary: string; link?: string }
  | { type: 'text_block'; content: string; title?: string }
  | { type: 'rich_text'; html: string }
  | { type: 'image'; src: string; alt?: string }
  | { type: 'cohi_widget'; sql: string; title: string; vizConfig: VisualizationConfig; explanation?: string; sourceType?: 'research' | 'chat'; sourceSessionId?: string };

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
