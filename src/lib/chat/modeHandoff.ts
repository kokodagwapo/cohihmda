/**
 * Cross-mode structural handoff (client → unified chat API).
 */

import type { UnifiedChatType, UnifiedChatScope, UnifiedChatLocation } from "@/lib/unifiedChatClient";
import type { CanvasStateSnapshot } from "@/types/widgetActions";
import {
  getMyDashboardCanvasIdFromPath,
  isMyDashboardCanvasPath,
} from "@/lib/workbench/workbenchChatHandoff";
import {
  getLatestWorkbenchActiveContext,
} from "@/lib/workbench/workbenchChatScopeSync";
import {
  getWorkbenchCanvasBridge,
  getWorkbenchCanvasSnapshotForDraft,
} from "@/lib/workbench/workbenchCanvasBridge";
import {
  getOrCreateActiveWorkbenchDraftScope,
  draftScopeIdForCanvasTab,
} from "@/lib/workbench/workbenchChatHandoff";
import { serializeWidgetCatalog } from "@/utils/widgetCatalogSerializer";

export interface ModeHandoffContext {
  fromChatType: UnifiedChatType;
  fromConversationId: string;
  fromTitle?: string;
  canvasState?: CanvasStateSnapshot;
  widgetCatalog?: string;
  canvasId?: string;
  canvasTitle?: string;
  route?: string;
}

export function isModeHandoffEnabled(): boolean {
  if (typeof import.meta !== "undefined" && import.meta.env?.VITE_UNIFIED_CHAT_MODE_HANDOFF === "false") {
    return false;
  }
  return true;
}

/** Build structural handoff when leaving workbench on a canvas for another chat mode. */
export function buildModeHandoffFromWorkbench(args: {
  fromChatType: UnifiedChatType;
  fromConversationId: string;
  fromTitle?: string;
  pathname?: string;
}): ModeHandoffContext | null {
  if (!isModeHandoffEnabled()) return null;
  const pathname =
    args.pathname ??
    (typeof window !== "undefined" ? window.location.pathname : "");
  if (!isMyDashboardCanvasPath(pathname)) return null;

  const canvasId = getMyDashboardCanvasIdFromPath(pathname);
  const ctx = buildWorkbenchRequestContext();
  const canvasState = (ctx.canvasState as CanvasStateSnapshot | undefined) ?? undefined;
  if (!canvasState || canvasState.totalItems === 0) return null;

  const activeCtx = getLatestWorkbenchActiveContext();
  return {
    fromChatType: args.fromChatType,
    fromConversationId: args.fromConversationId,
    fromTitle: args.fromTitle ?? activeCtx?.tabTitle,
    canvasState,
    widgetCatalog: serializeWidgetCatalog(),
    canvasId: canvasId ?? activeCtx?.canvasId ?? undefined,
    canvasTitle: activeCtx?.tabTitle,
    route: pathname,
  };
}

export function resolveGlobalStreamRouting(args: {
  chatType: UnifiedChatType;
  pathname?: string;
  workbenchCanvasId?: string | null;
}): { location: UnifiedChatLocation; scope: UnifiedChatScope } {
  const pathname =
    args.pathname ??
    (typeof window !== "undefined" ? window.location.pathname : "");

  if (
    args.chatType === "research" &&
    isMyDashboardCanvasPath(pathname)
  ) {
    const urlCanvasId = getMyDashboardCanvasIdFromPath(pathname);
    const canvasId = urlCanvasId ?? args.workbenchCanvasId ?? null;
    if (canvasId) {
      return {
        location: {
          surface: "workbench_canvas",
          route: pathname,
        },
        scope: {
          type: "canvas",
          id: canvasId,
        },
      };
    }
    const bridge = getWorkbenchCanvasBridge();
    if (bridge?.isActive && bridge.draftScopeId) {
      return {
        location: {
          surface: "workbench_canvas",
          route: pathname,
        },
        scope: {
          type: "draft",
          id: bridge.draftScopeId,
        },
      };
    }
    const draftScopeId = getOrCreateActiveWorkbenchDraftScope();
    return {
      location: {
        surface: "workbench_canvas",
        route: pathname,
      },
      scope: {
        type: "draft",
        id: draftScopeId,
      },
    };
  }

  return {
    location: { surface: "data_chat_page", route: pathname || undefined },
    scope: { type: "global_session" },
  };
}

/** Re-export for handoff builder without circular import from useCohiChat. */
function buildWorkbenchRequestContext(): Record<string, unknown> {
  const bridge = getWorkbenchCanvasBridge();
  if (bridge?.isActive) {
    return {
      canvasState: bridge.getCanvasSnapshot(),
      widgetCatalog: serializeWidgetCatalog(),
    };
  }
  const draftScopeId = getOrCreateActiveWorkbenchDraftScope();
  const canvasState =
    getWorkbenchCanvasSnapshotForDraft(draftScopeId) ?? {
      groups: [],
      standaloneWidgets: [],
      totalItems: 0,
    };
  return {
    canvasState,
    widgetCatalog: serializeWidgetCatalog(),
  };
}

export function draftScopeForCanvasTab(canvasId: string): string {
  return draftScopeIdForCanvasTab(canvasId);
}
