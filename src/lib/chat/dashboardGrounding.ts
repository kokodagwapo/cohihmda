/**
 * Client-side dashboard grounding for direct-entry Research / Insight Builder.
 */

import type { CanvasStateSnapshot } from "@/types/widgetActions";
import { getWorkbenchCanvasBridge, getWorkbenchCanvasSnapshotForDraft } from "@/lib/workbench/workbenchCanvasBridge";
import { getOrCreateActiveWorkbenchDraftScope } from "@/lib/workbench/workbenchChatHandoff";
import { serializeWidgetCatalog } from "@/utils/widgetCatalogSerializer";
import { getLatestWorkbenchActiveContext } from "@/lib/workbench/workbenchChatScopeSync";

export function isDashboardGroundingEnabled(): boolean {
  if (import.meta.env.VITE_UNIFIED_CHAT_DASHBOARD_GROUNDING === "false") {
    return false;
  }
  return true;
}

export function buildDashboardGroundingContext(): {
  canvasState?: CanvasStateSnapshot;
  canvasTitle?: string;
  widgetCatalog?: string;
  canvasId?: string;
  route?: string;
} | null {
  if (!isDashboardGroundingEnabled()) return null;

  const bridge = getWorkbenchCanvasBridge();
  const activeCtx = getLatestWorkbenchActiveContext();
  const canvasState =
    bridge?.isActive && bridge.getCanvasSnapshot
      ? (bridge.getCanvasSnapshot() as CanvasStateSnapshot)
      : (getWorkbenchCanvasSnapshotForDraft(getOrCreateActiveWorkbenchDraftScope()) as CanvasStateSnapshot);

  if (!canvasState || canvasState.totalItems === 0) return null;

  return {
    canvasState,
    canvasTitle: activeCtx?.tabTitle,
    widgetCatalog: serializeWidgetCatalog(),
    canvasId: activeCtx?.canvasId ?? bridge?.canvasId ?? undefined,
    route: typeof window !== "undefined" ? window.location.pathname : undefined,
  };
}
