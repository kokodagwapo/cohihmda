/**
 * COHI Response Plan – strict schema for structured COHI answers.
 * Used by CohiInsightPanel and /api/cohi/query.
 */

export type LayoutType = 'bullets' | 'table' | 'kpi_cards' | 'chart' | 'mixed';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type SectionType =
  | 'header_summary'
  | 'kpi_cards'
  | 'ranked_table'
  | 'grouped_table'
  | 'bullet_insights'
  | 'chart'
  | 'anomalies_and_risks'
  | 'forecast_and_scenarios'
  | 'recommended_actions'
  | 'data_notes';

// Section props by type
export interface HeaderSummaryProps {
  whatYouAsked: string;
  whatIFound: string;
  whyItMatters?: string;
}

export interface KpiCardItem {
  label: string;
  value: number | string;
  delta?: number;
  trend?: 'up' | 'down' | 'neutral';
  format?: 'number' | 'currency' | 'percent';
}

export interface KpiCardsProps {
  cards: KpiCardItem[];
}

export interface RankedTableColumn {
  key: string;
  label: string;
  format?: 'number' | 'currency' | 'percent' | 'text';
}

export interface HighlightRule {
  columnKey: string;
  condition: 'top' | 'bottom' | 'above' | 'below';
  value?: number;
  className?: string;
}

export interface RankedTableProps {
  columns: RankedTableColumn[];
  rows: Record<string, unknown>[];
  highlightRules?: HighlightRule[];
}

export interface GroupedTableProps {
  columns: RankedTableColumn[];
  rows: Record<string, unknown>[];
  groupBy?: string;
}

export interface BulletInsightItem {
  text: string;
  icon?: 'success' | 'warning' | 'info' | 'neutral';
}

export interface BulletInsightsProps {
  bullets: BulletInsightItem[];
}

export type ChartType = 'line' | 'bar' | 'area' | 'pie' | 'scatter';

export interface ChartSectionProps {
  chartType: ChartType;
  title: string;
  xKey: string;
  yKeys: string[];
  seriesLabels?: string[];
  dataRef: string;
  options?: {
    stacked?: boolean;
    showLegend?: boolean;
    showGrid?: boolean;
  };
}

export interface AnomalyRiskItem {
  title: string;
  description?: string;
  severity?: 'high' | 'medium' | 'low';
}

export interface AnomaliesAndRisksProps {
  items: AnomalyRiskItem[];
}

export interface ForecastScenarioItem {
  label: string;
  value?: number | string;
  description?: string;
}

export interface ForecastAndScenariosProps {
  items: ForecastScenarioItem[];
  title?: string;
}

export interface RecommendedActionItem {
  title: string;
  reason?: string;
  impact?: string;
  nextStep?: string;
}

export interface RecommendedActionsProps {
  actions: RecommendedActionItem[];
}

export interface DataSourceItem {
  type: 'db' | 'upload';
  name: string;
  id?: string;
}

export interface DataNotesProps {
  sources: DataSourceItem[];
  filtersApplied?: string[];
  caveats?: string[];
}

export type SectionProps =
  | HeaderSummaryProps
  | KpiCardsProps
  | RankedTableProps
  | GroupedTableProps
  | BulletInsightsProps
  | ChartSectionProps
  | AnomaliesAndRisksProps
  | ForecastAndScenariosProps
  | RecommendedActionsProps
  | DataNotesProps;

export interface ResponsePlanSection {
  type: SectionType;
  props: SectionProps;
}

export interface MissingDataRequest {
  question: string;
  options?: string[];
}

export interface ResponsePlan {
  layout_type: LayoutType;
  title: string;
  subtitle?: string;
  confidence_level: ConfidenceLevel;
  sections: ResponsePlanSection[];
  missing_data_requests?: MissingDataRequest[];
}

export interface CohiQueryAudit {
  queriesExecuted?: string[];
  datasetsUsed?: string[];
  uploadsUsed?: string[];
  generatedAt: string;
  latencyMs?: number;
}

export interface CohiQueryResponse {
  responsePlan: ResponsePlan;
  dataPayloads?: Record<string, unknown[]>;
  audit?: CohiQueryAudit;
}
