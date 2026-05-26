import type { UnifiedChatType } from "@/lib/unifiedChatClient";
import { CHAT_TYPE_LABELS } from "@/lib/unifiedChatTypeStyles";

/** Brief empty-state copy per chat type (from centralization spec §3). */
export const CHAT_TYPE_DESCRIPTIONS: Record<UnifiedChatType, string> = {
  chat: "Ask questions, explore metrics, and get quick answers about your business.",
  research:
    "Run deep investigations with timeline, findings, and structured reports.",
  insight_builder:
    "Describe custom daily insights you want to see, and AI will help you create the custom prompts",
  workbench:
    "Build and refine dashboards with AI—add widgets, layouts, and KPI views.",
};

/**
 * Data Chat starters — questions and lookups (not canvas or insight-authoring commands).
 * Tenant-agnostic: no branch numbers or client-specific IDs.
 */
export const CHAT_TOPIC_SUGGESTIONS = [
  "How has funded loan volume trended over the last 12 months?",
  "How is pull-through performing compared to last quarter?",
  "Which loan officers or branches lead funded volume this month?",
  "What are the main drivers of fallout in our pipeline?",
] as const;

/**
 * Research Lab investigation topics (empty state + legacy Research page).
 * Phrased as subjects to investigate, not UI commands.
 */
export const RESEARCH_TOPIC_SUGGESTIONS = [
  "Overall pipeline health and conversion performance",
  "Loan officer scorecard: volume, tiers, and performance outliers",
  "Credit risk: FICO, LTV, and DTI distributions and high-risk concentrations",
  "Turn time trends and operational efficiency by role",
  "Product mix and channel analysis by loan type and purpose",
  "Revenue and margin drivers by loan officer and channel",
] as const;

/**
 * Insight builder starters — natural language to author a My Insights prompt.
 * Tenant-agnostic: no hardcoded branch numbers, LO names, or client-specific IDs.
 */
export const INSIGHT_BUILDER_TOPIC_SUGGESTIONS = [
  "Create a weekly batch insight for a branch: week-over-week performance on pull-through and cycle time",
  "Create an insight on denial patterns—top reasons, trends, and loan officers with the highest rates",
  "Set up a recurring insight comparing my branch to similar-sized branches company-wide",
  "Create an on-demand insight on lock fallout and pricing on purchase loans",
  "Create a batch insight on refinance fallout and extensions vs last quarter, by branch and LO",
  "Create an on-demand insight to triage suspended loans—aging, reasons, and backlog by LO",
  "Create an insight on fallout for lower-credit loans, by loan type and channel",
] as const;

/**
 * Workbench starters for an empty canvas / new board — build and populate.
 * Safe on blank chat, `/my-dashboard/new`, or before any widgets exist.
 */
export const WORKBENCH_EMPTY_CANVAS_TOPIC_SUGGESTIONS = [
  "Prepare a board-ready overview of this month's performance",
  "Build an executive dashboard with funded volume, pull-through, and cycle time KPIs",
  "Create a pipeline review board with loans by stage and fallout risk",
  "Add a monthly performance section with volume, margin, and pull-through KPIs",
] as const;

/**
 * Workbench starters when the open canvas already has widgets — refine, period, export.
 * Not shown on empty canvas / global chat empty state without a populated board.
 */
export const WORKBENCH_POPULATED_CANVAS_TOPIC_SUGGESTIONS = [
  "Switch the whole dashboard to month-to-date",
  "Add a chart of funded volume by branch or loan officer",
  "Change the top KPI widgets to show year-to-date instead of month-to-date",
  "Export this canvas as a slide deck for leadership",
] as const;

/** @deprecated Use resolveWorkbenchTopicSuggestions — defaults to empty-canvas list. */
export const WORKBENCH_TOPIC_SUGGESTIONS = WORKBENCH_EMPTY_CANVAS_TOPIC_SUGGESTIONS;

export function resolveWorkbenchTopicSuggestions(
  canvasPopulated: boolean,
): string[] {
  return canvasPopulated
    ? [...WORKBENCH_POPULATED_CANVAS_TOPIC_SUGGESTIONS]
    : [...WORKBENCH_EMPTY_CANVAS_TOPIC_SUGGESTIONS];
}

/** Default starter prompts when the server has not returned suggestions yet. */
export const CHAT_TYPE_DEFAULT_SUGGESTIONS: Record<UnifiedChatType, string[]> = {
  chat: [...CHAT_TOPIC_SUGGESTIONS],
  research: [...RESEARCH_TOPIC_SUGGESTIONS],
  insight_builder: [...INSIGHT_BUILDER_TOPIC_SUGGESTIONS],
  workbench: [...WORKBENCH_EMPTY_CANVAS_TOPIC_SUGGESTIONS],
};

export const DEFAULT_CHAT_SUGGESTIONS = CHAT_TYPE_DEFAULT_SUGGESTIONS.chat;

export function getChatTypeLabel(chatType: UnifiedChatType) {
  return CHAT_TYPE_LABELS[chatType];
}
