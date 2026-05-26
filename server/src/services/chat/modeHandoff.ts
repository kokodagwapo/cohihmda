/**
 * Cross-mode structural handoff (client → server via unified chat context).
 */

import type { UnifiedChatRequestBody } from "./unifiedChatOrchestrator.js";
import type { CanvasStateSnapshot } from "./canvasContextBuilder.js";
import type { ResearchWidgetContext } from "../../types/researchWidgetContext.js";

export interface ModeHandoffContextPayload {
  fromChatType?: string;
  fromConversationId?: string;
  fromTitle?: string;
  canvasState?: CanvasStateSnapshot;
  widgetCatalog?: string;
  widgetCatalogMeta?: ResearchWidgetContext["meta"];
  canvasId?: string;
  canvasTitle?: string;
  route?: string;
}

export function isModeHandoffEnabled(): boolean {
  return process.env.UNIFIED_CHAT_MODE_HANDOFF !== "false";
}

export function readModeHandoffContext(
  body: UnifiedChatRequestBody,
): ModeHandoffContextPayload | null {
  if (!isModeHandoffEnabled()) return null;
  const raw = body.context?.modeHandoffContext as
    | ModeHandoffContextPayload
    | undefined;
  if (!raw?.fromConversationId) return null;
  if (!raw.canvasState && !raw.widgetCatalog?.trim()) return null;
  return raw;
}
