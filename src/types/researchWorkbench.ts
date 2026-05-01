export type ResearchVisualizationMatchConfidence = "high" | "medium" | "low";

export interface ResearchVisualizationSource {
  kind: "dashboard" | "registry_widget";
  dashboardPath: string;
  dashboardLabel: string;
  sectionId?: string;
  definitionId?: string;
  widgetName?: string;
  matchConfidence: ResearchVisualizationMatchConfidence;
  navigateState?: Record<string, unknown>;
}
