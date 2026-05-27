/**
 * Default dashboard/canvas grounding for Research and Insight Builder direct-entry.
 */

import type { UnifiedChatRequestBody } from "./unifiedChatOrchestrator.js";
import type { ModeHandoffContextPayload } from "./modeHandoff.js";
import { isModeHandoffEnabled, readModeHandoffContext } from "./modeHandoff.js";
import type { CanvasStateSnapshot } from "./canvasContextBuilder.js";

export function isDashboardGroundingEnabled(): boolean {
  if (!isModeHandoffEnabled()) return false;
  return process.env.UNIFIED_CHAT_DASHBOARD_GROUNDING !== "false";
}

/**
 * Merge explicit mode handoff with optional dashboard-only grounding from client context.
 * Allows canvas snapshot without a prior conversation id (direct-entry Research/Insights).
 */
/** Prefer dashboard grounding payload, then strict mode handoff. */
export function resolveModeHandoffContext(
  body: UnifiedChatRequestBody,
): ModeHandoffContextPayload | null {
  const dashboard = readDashboardGroundingHandoff(body);
  if (dashboard) return dashboard;
  return readModeHandoffContext(body);
}

/** Map client routes to human-readable dashboard labels for chat steering. */
export function resolveChatRouteGroundingLabel(
  route?: string | null,
): string | undefined {
  if (!route) return undefined;
  const map: Record<string, string> = {
    "/sales-scorecard": "Sales Scorecard (LO tiers / TTS)",
    "/sales-scorecard-overview": "Sales Scorecard Overview",
    "/operations-scorecard": "Operations Scorecard",
    "/performance/toptiering-comparison": "Top Tiering Comparison",
    "/top-tiering-comparison": "Top Tiering Comparison",
    "/company-scorecard": "Company Scorecard",
    "/pipeline-analysis": "Pipeline Analysis",
    "/workflow-conversion": "Workflow Conversion",
    "/leaderboard": "Leaderboard",
    "/business-overview": "Business Overview",
  };
  return map[route];
}

export function readDashboardGroundingHandoff(
  body: UnifiedChatRequestBody,
): ModeHandoffContextPayload | null {
  if (!isDashboardGroundingEnabled()) return null;

  const explicit = body.context?.modeHandoffContext as
    | ModeHandoffContextPayload
    | undefined;

  const dashboardOnly = body.context?.dashboardGrounding as
    | {
        canvasState?: CanvasStateSnapshot;
        canvasTitle?: string;
        widgetCatalog?: string;
        route?: string;
        canvasId?: string;
      }
    | undefined;

  const canvas =
    explicit?.canvasState ?? dashboardOnly?.canvasState;
  const hasCanvas =
    canvas && typeof canvas.totalItems === "number" && canvas.totalItems > 0;
  const hasCatalog = Boolean(
    explicit?.widgetCatalog?.trim() || dashboardOnly?.widgetCatalog?.trim(),
  );

  if (!hasCanvas && !hasCatalog) {
    if (
      explicit?.fromConversationId &&
      (explicit.canvasState || explicit.widgetCatalog?.trim())
    ) {
      return explicit;
    }
    return null;
  }

  return {
    fromChatType: explicit?.fromChatType ?? "chat",
    fromConversationId:
      explicit?.fromConversationId ?? body.conversationId ?? "direct-entry",
    fromTitle: explicit?.fromTitle,
    canvasState: canvas,
    widgetCatalog:
      explicit?.widgetCatalog?.trim() || dashboardOnly?.widgetCatalog,
    widgetCatalogMeta: explicit?.widgetCatalogMeta,
    canvasId: explicit?.canvasId ?? dashboardOnly?.canvasId,
    canvasTitle: explicit?.canvasTitle ?? dashboardOnly?.canvasTitle,
    route: explicit?.route ?? dashboardOnly?.route,
  };
}
