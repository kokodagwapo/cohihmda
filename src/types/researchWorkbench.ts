/**
 * Shared types for Research Lab ↔ Workbench handoff (COHI-365).
 * Kept dependency-free so `canvas/types.ts` can import without cycles.
 */

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
