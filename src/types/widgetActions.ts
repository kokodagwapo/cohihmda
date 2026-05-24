/**
 * Widget Action Types
 *
 * Defines the structured actions that Cohi can emit in response to
 * workbench-mode conversations. The frontend widgetActionExecutor
 * interprets these to modify the canvas.
 */

import type { VisualizationConfig } from '@/hooks/useCohiChat';
import type { ReportDefinition } from '@/types/reportTypes';
import type { SectionFilters, SectionType } from '@/stores/widgetSectionStore';
import type { ResearchArtifactCapabilities } from '@/components/workbench/canvas/types';
import type { ResearchVisualizationSource } from '@/types/researchWorkbench';

// ---------------------------------------------------------------------------
// Action union
// ---------------------------------------------------------------------------

export type WidgetAction =
  | AddExistingWidgetAction
  | CreateWidgetAction
  | CreateCanvasAction
  | ModifyWidgetAction
  | DeleteWidgetAction
  | SuggestDashboardAction
  | ModifyGroupAction
  | ModifyRegistryWidgetAction
  | CreateDashboardAction
  | ConvertToSqlWidgetAction
  | ExplainWidgetAction
  | ExplainSchemaAction
  | QueryDataAction
  | GenerateReportAction;

export interface AddExistingWidgetAction {
  type: 'add_existing_widget';
  /** Widget definition ID from the registry (e.g. "company-scorecard-volume-by-branch") */
  widgetId: string;
  /** Optional target group ID on the canvas */
  groupId?: string;
  /** LLM-generated explanation for the user */
  explanation: string;
}

export interface CreateWidgetAction {
  type: 'create_widget';
  /** SQL query to execute against the tenant database */
  sql: string;
  /** Visualization configuration for rendering */
  config: VisualizationConfig;
  /** Widget title */
  title: string;
  /** LLM-generated explanation */
  explanation: string;
  /**
   * Optional explicit override for pull-through segmented views.
   * When true, low-sample segments are allowed (no minimum completed_count HAVING gate).
   * Use only when the user explicitly asks to include small-sample branches/LOs.
   */
  allowLowSamplePullThrough?: boolean;
}

export interface ModifyWidgetAction {
  type: 'modify_widget';
  /** Instance ID on the canvas to modify */
  instanceId: string;
  /** Partial changes to apply to the visualization config */
  changes: Partial<VisualizationConfig>;
  /** New SQL query to replace the existing one (for cohi_widget items) */
  sql?: string;
  /** New widget title */
  title?: string;
  /** LLM-generated explanation */
  explanation: string;
}

export interface DeleteWidgetAction {
  type: 'delete_widget';
  /** Instance ID on the canvas to remove */
  instanceId: string;
  /** LLM-generated explanation */
  explanation: string;
}

export interface CreateCanvasAction {
  type: 'create_canvas';
  /** Human-readable title for the canvas */
  title: string;
  /** Array of section keys from SECTION_TO_WIDGETS to add */
  sectionKeys: string[];
  /** LLM-generated explanation */
  explanation: string;
}

export interface SuggestDashboardAction {
  type: 'suggest_dashboard';
  /** Section key from SECTION_TO_WIDGETS (e.g. "companyScorecard") */
  sectionKey: string;
  /** LLM-generated explanation */
  explanation: string;
}

// ---------------------------------------------------------------------------
// Phase 1: Group layout manipulation
// ---------------------------------------------------------------------------

export type GroupOperation =
  | {
      op: 'add_registry';
      defId: string;
      gridPosition?: { x: number; y: number; w: number; h: number };
    }
  | {
      op: 'add_cohi';
      sql: string;
      title: string;
      vizConfig: VisualizationConfig;
      gridPosition?: { x: number; y: number; w: number; h: number };
    }
  | { op: 'remove'; widgetId: string }
  | { op: 'resize'; widgetId: string; w: number; h: number }
  | { op: 'reorder'; widgetIds: string[] }
  | { op: 'set_title'; title: string }
  | { op: 'set_filters'; filters: Partial<SectionFilters> }
  | { op: 'set_period'; preset: string }
  | { op: 'set_widget_title'; widgetId: string; title: string };

export interface ModifyGroupAction {
  type: 'modify_group';
  groupId: string;
  operations: GroupOperation[];
  explanation: string;
}

// ---------------------------------------------------------------------------
// Phase 2: Registry widget config overrides
// ---------------------------------------------------------------------------

export interface ModifyRegistryWidgetAction {
  type: 'modify_registry_widget';
  groupId: string;
  /** Registry defId or stable item id within the group */
  widgetId: string;
  configOverrides: Record<string, unknown>;
  explanation: string;
}

// ---------------------------------------------------------------------------
// Phase 3: Full template creation
// ---------------------------------------------------------------------------

export interface DashboardGroupSpec {
  title: string;
  sectionType?: SectionType;
  widgets: (
    | { kind: 'registry'; defId: string }
    | { kind: 'cohi'; sql: string; title: string; vizConfig: VisualizationConfig }
  )[];
  canvasPosition?: { x: number; y: number; w: number; h: number };
}

export interface StandaloneWidgetSpec {
  kind: 'cohi';
  sql: string;
  title: string;
  vizConfig: VisualizationConfig;
  canvasPosition?: { x: number; y: number; w: number; h: number };
}

export interface CreateDashboardAction {
  type: 'create_dashboard';
  title: string;
  groups: DashboardGroupSpec[];
  standaloneWidgets?: StandaloneWidgetSpec[];
  explanation: string;
}

// ---------------------------------------------------------------------------
// Phase 4: Registry-to-SQL conversion
// ---------------------------------------------------------------------------

export interface ConvertToSqlWidgetAction {
  type: 'convert_to_sql_widget';
  groupId: string;
  /** Registry widget defId within the group to replace */
  widgetId: string;
  sql: string;
  title: string;
  vizConfig: VisualizationConfig;
  explanation: string;
}

// ---------------------------------------------------------------------------
// Explain / Query / Report
// ---------------------------------------------------------------------------

export interface ExplainWidgetAction {
  type: 'explain_widget';
  /** Widget ID to explain */
  widgetId: string;
  /** LLM-generated teaching explanation */
  explanation: string;
}

export interface ExplainSchemaAction {
  type: 'explain_schema';
  /** Field names being explained */
  fields: string[];
  /** LLM-generated explanation of the fields/metrics */
  explanation: string;
}

export interface QueryDataAction {
  type: 'query_data';
  /** SQL query that was executed to answer the user's question */
  sql: string;
  /** What the query was checking */
  explanation: string;
  /** Query results (populated by backend before returning to frontend) */
  results?: unknown[];
}

export interface GenerateReportAction {
  type: 'generate_report';
  /** Full report definition with slides, elements, and data sources */
  reportDefinition: Omit<ReportDefinition, 'id' | 'metadata'>;
  /** Requested output format */
  format?: 'pptx' | 'pdf';
  /** LLM-generated explanation of the report structure */
  explanation: string;
}

// ---------------------------------------------------------------------------
// Workbench chat message (extends base chat message with actions)
// ---------------------------------------------------------------------------

export interface WorkbenchChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Structured actions the user can execute with one click */
  actions?: WidgetAction[];
  /** Teaching notes (e.g. how a widget works, field definitions) */
  teachingNotes?: string;
  timestamp: Date;
  isLoading?: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Canvas state snapshot (sent to server as context)
// ---------------------------------------------------------------------------

/** Widget list item within a group (for LLM context) */
export interface CanvasStateSnapshotGroupWidget {
  /** Stable id used in widgetLayouts and modify_group operations (defId__idx or cohi__id__idx) */
  id: string;
  kind: 'registry' | 'cohi';
  defId?: string;
  title?: string;
  /** Display name for registry widgets */
  name?: string;
  /** For cohi widgets inside groups: SQL backing the widget */
  sql?: string;
}

export interface CanvasStateSnapshot {
  /** All widget groups currently on the canvas */
  groups: {
    groupId: string;
    /** Freeform layout item id (item.i) — use modify_group.groupId with either this or groupId */
    layoutId?: string;
    title: string;
    sectionType: string;
    widgetIds: string[];
    /** Widgets in this group with stable ids and layout keys */
    widgets?: CanvasStateSnapshotGroupWidget[];
    /** Grid layout per widget (key = widget id from widgets[].id) */
    widgetLayouts?: Record<string, { x: number; y: number; w: number; h: number }>;
    /** Active filter state for the group (date range, branch, etc.) */
    filters?: {
      dateRange?: string;
      dateField?: string;
      branch?: string;
      loanOfficer?: string;
    };
  }[];
  /** All standalone items on the canvas */
  standaloneWidgets: {
    id: string;
    type: string;
    title?: string;
    /** For cohi_widget items: where the widget originated */
    sourceType?: 'research' | 'chat';
    /** For research-sourced widgets: the research session that produced them */
    sourceSessionId?: string;
    /** Durable research artifact row (when saved from Research Lab) */
    sourceArtifactId?: string;
    /** Capability flags for research-backed widgets (filter injection, presentation edits) */
    artifactCapabilities?: ResearchArtifactCapabilities;
    /** Optional link to canonical product dashboard (COHI-365). */
    sourceDashboard?: ResearchVisualizationSource;
    filterConfig?: { filterable?: boolean; dateColumn?: string; defaultPreset?: string | null };
    savedFilters?: Record<string, unknown>;
    /** For cohi_widget items: the SQL backing the widget */
    sql?: string;
    /** True when this widget is the one the user is editing via Cohi */
    selected?: boolean;
  }[];
  /** Total item count */
  totalItems: number;
  /** Actual data from rendered widgets (KPI values, chart data, etc.) */
  widgetData?: {
    itemId: string;
    widgetName: string;
    category: string;
    data: unknown;
  }[];
}
