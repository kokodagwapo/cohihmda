/**
 * COHI Insight Engine – builds bullet insights from data (optional enrichment).
 * Used by responsePlanner when OpenAI is available for summaries.
 */

export interface InsightItem {
  text: string;
  icon?: "success" | "warning" | "info" | "neutral";
}

export function insightEngine(
  _data: Record<string, { rows: Record<string, unknown>[] }>,
  _intent: string
): InsightItem[] {
  // Minimal: return empty; responsePlanner builds sections from data directly
  return [];
}
