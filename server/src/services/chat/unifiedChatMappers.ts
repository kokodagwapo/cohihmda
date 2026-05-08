/**
 * Map legacy chat/workbench outputs to unified block responses.
 */

import { randomUUID } from "crypto";
import type { CohiChatResponse, VisualizationConfig } from "../ai/cohiChatService.js";
import { sanitizeNavigationHints } from "./unifiedChatPolicy.js";

export type UnifiedBlock =
  | { type: "text"; markdown: string }
  | {
      type: "citations";
      items: { id?: string; title?: string; snippet?: string; uri?: string }[];
    }
  | {
      type: "visualization";
      artifactId?: string;
      config: VisualizationConfig;
    }
  | { type: "actions"; items: unknown[]; teachingNotes?: string }
  | {
      type: "artifacts";
      items: { kind: string; ref: string; meta?: object }[];
    }
  | {
      type: "navigation_hints";
      items: { label: string; path: string }[];
    }
  | { type: "safety"; reason: string; category?: string };

export function mapCohiChatResponseToBlocks(
  resp: CohiChatResponse,
  opts?: { visualizationArtifactId?: string },
): UnifiedBlock[] {
  const blocks: UnifiedBlock[] = [];

  if (resp.message) {
    blocks.push({ type: "text", markdown: resp.message });
  }

  if (resp.sources?.knowledgeBase?.length) {
    blocks.push({
      type: "citations",
      items: resp.sources.knowledgeBase.map((title, i) => ({
        id: `kb-${i}`,
        title,
        snippet: title,
      })),
    });
  }

  if (resp.visualization) {
    blocks.push({
      type: "visualization",
      artifactId: opts?.visualizationArtifactId ?? randomUUID(),
      config: resp.visualization,
    });
  }

  const navItems = sanitizeNavigationHints(resp.navigationHints);
  if (navItems.length > 0) {
    blocks.push({ type: "navigation_hints", items: navItems });
  }

  return blocks;
}

export function mapWorkbenchResponseToBlocks(resp: {
  message: string;
  actions?: unknown[];
  teachingNotes?: string;
  suggestedQuestions?: string[];
  error?: string;
}): UnifiedBlock[] {
  const blocks: UnifiedBlock[] = [];
  if (resp.error) {
    blocks.push({
      type: "text",
      markdown: resp.message || `Error: ${resp.error}`,
    });
    blocks.push({ type: "safety", reason: resp.error, category: "workbench_error" });
    return blocks;
  }
  if (resp.message) {
    blocks.push({ type: "text", markdown: resp.message });
  }
  if (resp.actions?.length) {
    blocks.push({
      type: "actions",
      items: resp.actions,
      teachingNotes: resp.teachingNotes,
    });
  }
  return blocks;
}
