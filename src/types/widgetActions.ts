/**
 * Widget Action Types
 *
 * Defines the structured actions that Cohi can emit in response to
 * workbench-mode conversations. The frontend widgetActionExecutor
 * interprets these to modify the canvas.
 */

import type { VisualizationConfig } from '@/hooks/useCohiChat';
import type { ReportDefinition } from '@/types/reportTypes';

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
}

export interface ModifyWidgetAction {
  type: 'modify_widget';
  /** Instance ID on the canvas to modify */
  instanceId: string;
  /** Partial changes to apply */
  changes: Partial<VisualizationConfig>;
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

export interface CanvasStateSnapshot {
  /** All widget groups currently on the canvas */
  groups: {
    groupId: string;
    title: string;
    sectionType: string;
    widgetIds: string[];
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
