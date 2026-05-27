/**
 * Routes presentation-export intent to per-chat-type actions.
 */

import {
  detectPresentationExportIntent,
  type PresentationExportMetadata,
} from "./presentationExportIntent.js";
import type { UnifiedConversationChatType } from "./unifiedConversationService.js";

export type { PresentationExportMetadata } from "./presentationExportIntent.js";

export async function routePresentationExportIntent(args: {
  message: string;
  chatType: UnifiedConversationChatType;
  history?: { role: string; content: string }[];
  tenantId?: string;
}): Promise<PresentationExportMetadata | null> {
  return detectPresentationExportIntent(args);
}
